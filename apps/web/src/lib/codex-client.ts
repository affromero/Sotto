import { spawn } from 'child_process';
import { readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getCodexSshHost, isCodexAvailable } from './agent-availability';
import { logger } from './logger';
import { buildAgentInvocation, minimalAgentEnvironment } from './agent-invocation';
import { parseAgentModelId, type AgentEffortLevel } from './agent-models/id';
import { installCurrentProviderCredentialSnapshot } from './agent-credentials';

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
const CODEX_ENV_KEYS = ['CODEX_HOME', 'CODEX_API_KEY'];

export { getCodexSshHost, isCodexAvailable };

interface CodexResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

interface CodexOptions {
  model?: string;
  timeoutMs?: number;
  effort?: AgentEffortLevel;
  useWebSearch?: boolean;
}

export function codexEnvironment(): NodeJS.ProcessEnv {
  installCurrentProviderCredentialSnapshot('codex');
  return minimalAgentEnvironment(CODEX_ENV_KEYS);
}

/** Resolve the model override, stripping the `codex:` routing prefix. The bare
 * provider id "codex" and an empty value both mean "use Codex's configured default". */
function resolveSelection(opts?: CodexOptions): { model: string; effort?: AgentEffortLevel } {
  const selected =
    (opts?.model && opts.model !== 'codex' ? opts.model : process.env.CODEX_MODEL) ?? '';
  const parsed = parseAgentModelId(selected, 'codex');
  const model = parsed?.model ?? '';
  const effort =
    opts?.effort ??
    parsed?.effort ??
    parseAgentModelId(
      `codex${model ? `:${model}` : ''}#effort=${
        process.env.CODEX_MODEL_REASONING_EFFORT ?? process.env.CODEX_EFFORT ?? ''
      }`
    )?.effort ??
    undefined;
  return effort ? { model, effort } : { model };
}

function codexArgs(
  opts?: CodexOptions,
  outFile?: string
): {
  args: string[];
  model: string;
  effort?: AgentEffortLevel;
} {
  const { model, effort } = resolveSelection(opts);
  const args = [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    ...NO_MCP,
    '-c',
    `web_search=${JSON.stringify(opts?.useWebSearch ? 'live' : 'disabled')}`,
    // Shell snapshots capture the interactive shell environment — useless for
    // stdin-driven exec calls, and snapshot validation crashes codex on
    // busybox /bin/sh inside the alpine containers (exit 1 before any work).
    '-c',
    'features.shell_snapshot=false',
    ...SANDBOX,
    '--skip-git-repo-check',
  ];
  if (outFile) args.push('-o', outFile);
  if (model) args.push('-m', model);
  if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
  args.push('-');
  return effort ? { args, model, effort } : { args, model };
}

/**
 * Turn a raw codex CLI failure into a message the UI can act on. Route
 * handlers surface `error.message` directly to the learner, so rate limits and
 * auth problems must say what to do (switch model / re-auth), not just dump
 * stderr.
 */
function classifyCodexFailure(code: number | null, stderr: string): string {
  if (/rate.?limit|usage.?limit|too many requests|quota|429/i.test(stderr)) {
    const reset = stderr.match(/try again (?:at|in) ([^.\n]+)/i)?.[1];
    return (
      'The Codex AI provider has hit its usage limit' +
      (reset ? ` (available again ${reset.trim()})` : '') +
      '. Switch to another AI model in Settings, or try again later.'
    );
  }
  if (/unauthorized|authentication|not logged in|401/i.test(stderr)) {
    return 'The Codex AI provider is not authenticated. Re-connect Codex or switch to another AI model in Settings.';
  }
  // Real errors come last in stderr — the head is a version/session banner.
  return `codex: exited with code ${code} — ${stderr.slice(-500)}`;
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
  const timeoutMs = opts?.timeoutMs || 600_000;
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  const outFile = join(
    /* turbopackIgnore: true */ tmpdir(),
    `codex-${process.pid}-${Date.now()}.txt`
  );

  const { args, model, effort } = codexArgs(opts, outFile);

  logger.info('codex: executing', {
    model: model || '(configured default)',
    effort: effort ?? '(configured default)',
    promptLength: String(fullPrompt.length),
  });

  return new Promise((resolve, reject) => {
    const { command, args: spawnArgs } = buildAgentInvocation('codex', args, getCodexSshHost(), {
      remoteEnvKeys: CODEX_ENV_KEYS,
    });
    const child = spawn(command, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: codexEnvironment(),
    });

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
        reject(new Error(classifyCodexFailure(code, stderr)));
        return;
      }

      let content = '';
      try {
        content = readFileSync(/* turbopackIgnore: true */ outFile, 'utf8').trim();
      } catch {
        // fall back to stdout below
      }
      try {
        unlinkSync(/* turbopackIgnore: true */ outFile);
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

/** Forward the progressive stdout emitted by current `codex exec` releases. */
export async function* streamCodex(
  systemPrompt: string,
  prompt: string,
  opts?: CodexOptions
): AsyncGenerator<string> {
  const timeoutMs = opts?.timeoutMs || 600_000;
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  const { args } = codexArgs(opts);
  const { command, args: spawnArgs } = buildAgentInvocation('codex', args, getCodexSshHost(), {
    remoteEnvKeys: CODEX_ENV_KEYS,
  });
  const child = spawn(command, spawnArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: codexEnvironment(),
  });
  const chunks: string[] = [];
  let notify: (() => void) | null = null;
  let done = false;
  let failure: Error | null = null;
  let stderr = '';
  let produced = false;
  const timer = setTimeout(() => {
    child.kill('SIGTERM');
    failure = new Error(`codex: timed out after ${timeoutMs}ms`);
  }, timeoutMs);
  child.stdout.on('data', (chunk: Buffer) => {
    produced = true;
    chunks.push(chunk.toString());
    notify?.();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.on('error', (error) => {
    failure = new Error(`codex: failed to spawn — ${error.message}. Is the 'codex' CLI installed?`);
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code !== 0 && !failure) {
      failure = new Error(`codex: exited with code ${code} — ${stderr.slice(0, 500)}`);
    } else if (!produced && !failure) {
      failure = new Error(
        `codex: no output produced (empty response). Buffer: ${stderr.trim().slice(0, 300) || '(empty)'}`
      );
    }
    done = true;
    notify?.();
  });
  child.stdin.write(fullPrompt);
  child.stdin.end();

  while (!done || chunks.length > 0) {
    if (chunks.length === 0) {
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
      notify = null;
      continue;
    }
    yield chunks.shift() as string;
  }
  if (failure) throw failure;
}
