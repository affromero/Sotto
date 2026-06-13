import { spawn } from 'child_process';
import { readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isCommandAvailable } from './local-command';
import { logger } from './logger';
import { buildAgentInvocation } from './claude-code-client';

/**
 * Codex CLI provider client — routes AI calls through `codex exec` in a
 * read-only sandbox (no file writes, no command execution), so Codex behaves as
 * a pure text generator. Modeled on claude-code-client. The prompt is piped via
 * stdin; the final assistant message is captured from a temp output file (with a
 * stdout fallback). A model is passed only when explicitly selected, so by
 * default Codex uses the model configured in the user's Codex setup.
 *
 * NOTE: the exact `codex exec` flags depend on the installed Codex CLI version;
 * this matches the documented invocation but is validated at runtime, not here.
 */

const SANDBOX = ['-s', 'read-only'];
const NO_MCP = ['-c', 'mcp_servers={}'];

/** Trimmed CODEX_SSH_HOST, or undefined when the CLI runs locally. */
export function getCodexSshHost(): string | undefined {
  const host = process.env.CODEX_SSH_HOST?.trim();
  return host ? host : undefined;
}

export function isCodexAvailable(): Promise<boolean> {
  // With a remote agent (VPS), "available" means the local ssh client exists;
  // the remote `codex` is validated on first execution.
  if (getCodexSshHost()) return isCommandAvailable('ssh');
  return isCommandAvailable('codex');
}

interface CodexResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

interface CodexOptions {
  model?: string;
  timeoutMs?: number;
}

/** Resolve the model override, stripping the `codex:` routing prefix. The bare
 * provider id "codex" and an empty value both mean "use Codex's configured default". */
function resolveModel(model?: string): string {
  const selected = (model || process.env.CODEX_MODEL || '').trim();
  if (selected === 'codex') return '';
  return selected.startsWith('codex:') ? selected.slice('codex:'.length) : selected;
}

/**
 * Spawn `codex exec` and return the full response. Codex has no system-prompt
 * flag, so the system prompt is prepended to the user prompt.
 */
export async function executeCodex(
  systemPrompt: string,
  prompt: string,
  opts?: CodexOptions
): Promise<CodexResponse> {
  const model = resolveModel(opts?.model);
  const timeoutMs = opts?.timeoutMs || 600_000;
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  const outFile = join(tmpdir(), `codex-${process.pid}-${Date.now()}.txt`);

  const args = ['exec', ...SANDBOX, ...NO_MCP, '-o', outFile];
  if (model) args.push('-m', model);
  args.push('-'); // read the prompt from stdin

  logger.info('codex: executing', {
    model: model || '(configured default)',
    promptLength: String(fullPrompt.length),
  });

  return new Promise((resolve, reject) => {
    const { command, args: spawnArgs } = buildAgentInvocation('codex', args, getCodexSshHost());
    const child = spawn(command, spawnArgs, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`codex: timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        logger.error('codex: non-zero exit', { code: String(code), stderr });
        reject(new Error(`codex: exited with code ${code} — ${stderr.slice(0, 500)}`));
        return;
      }

      let content = '';
      try {
        content = readFileSync(outFile, 'utf8').trim();
      } catch {
        // fall back to stdout below
      }
      try {
        unlinkSync(outFile);
      } catch {
        // best-effort cleanup
      }
      if (!content) content = stdout.trim();

      if (!content) {
        const detail = stderr.trim().slice(0, 300) || '(empty)';
        reject(new Error(`codex: no output produced (empty response). Buffer: ${detail}`));
        return;
      }
      resolve({ content, inputTokens: 0, outputTokens: 0 });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`codex: failed to spawn — ${err.message}. Is the 'codex' CLI installed?`));
    });

    child.stdin.write(fullPrompt);
    child.stdin.end();
  });
}

/**
 * Codex exec does not expose a simple token stream, so streaming yields the full
 * result once (the generation still runs to completion in the sandbox first).
 */
export async function* streamCodex(
  systemPrompt: string,
  prompt: string,
  opts?: CodexOptions
): AsyncGenerator<string> {
  const result = await executeCodex(systemPrompt, prompt, opts);
  yield result.content;
}
