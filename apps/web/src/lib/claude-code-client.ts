import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getClaudeSshHost, isClaudeAvailable } from './agent-availability';
import { buildAgentInvocation } from './agent-invocation';
import { parseAgentModelId, type AgentEffortLevel } from './agent-models/id';
import { logger } from './logger';
import { getAiProviderMeta } from './providers/ai-registry';

const CLAUDE_CODE_DEFAULT_MODEL = getAiProviderMeta('claude-code').defaultModel;

export { buildAgentInvocation, shellQuote } from './agent-invocation';
export { getClaudeSshHost, isClaudeAvailable };
export { serializeMessages } from './agent-messages';

/**
 * Prepare a writable HOME directory for the claude subprocess.
 *
 * The claude CLI needs a writable ~/.claude directory to store session data
 * (todos, debug logs, history). Volume-mounted host credentials are often
 * root-owned and read-only, which causes permission errors at runtime.
 *
 * Strategy (in priority order):
 *  1. CLAUDE_CODE_CREDENTIALS_JSON env var → write to /tmp/claude-runtime/.claude/
 *  2. CLAUDE_HOME env var → use as-is (legacy volume mount)
 *  3. Fall back to process HOME
 *
 * Result is cached — the writable dir persists for the container lifetime.
 */
let _claudeHome: string | null | undefined = undefined;
function ensureClaudeHome(): string | undefined {
  if (_claudeHome !== undefined) return _claudeHome ?? undefined;

  const credsJson = process.env.CLAUDE_CODE_CREDENTIALS_JSON;
  if (credsJson) {
    try {
      const runtimeDir = '/tmp/claude-runtime';
      const claudeDir = join(/* turbopackIgnore: true */ runtimeDir, '.claude');
      mkdirSync(/* turbopackIgnore: true */ claudeDir, { recursive: true });
      writeFileSync(
        /* turbopackIgnore: true */ join(
          /* turbopackIgnore: true */ claudeDir,
          '.credentials.json'
        ),
        credsJson,
        { mode: 0o600 }
      );
      _claudeHome = runtimeDir;
      logger.info('claude-code: initialized writable home from CLAUDE_CODE_CREDENTIALS_JSON', {
        dir: runtimeDir,
      });
      return runtimeDir;
    } catch (err) {
      logger.warn('claude-code: failed to write credentials to /tmp', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Fall back to CLAUDE_HOME (volume-mount approach)
  _claudeHome = process.env.CLAUDE_HOME ?? null;
  return _claudeHome ?? undefined;
}

interface ClaudeCodeResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

interface ClaudeCodeOptions {
  model?: string;
  timeoutMs?: number;
  useWebSearch?: boolean;
  effort?: AgentEffortLevel;
}

function buildArgs(model: string, systemPrompt: string, opts?: ClaudeCodeOptions): string[] {
  const args = ['-p', '--model', model, '--output-format', 'text'];
  if (opts?.effort) args.push('--effort', opts.effort);
  if (systemPrompt) args.push('--system-prompt', systemPrompt);
  if (opts?.useWebSearch) args.push('--allowedTools', 'WebSearch,WebFetch');
  return args;
}

function resolveSelection(opts?: ClaudeCodeOptions): { model: string; effort?: AgentEffortLevel } {
  const selected = opts?.model || process.env.CLAUDE_CODE_MODEL || CLAUDE_CODE_DEFAULT_MODEL;
  const parsed = parseAgentModelId(selected, 'claude-code');
  const model = parsed?.model || CLAUDE_CODE_DEFAULT_MODEL;
  const effort =
    opts?.effort ??
    parsed?.effort ??
    parseAgentModelId(`claude-code:${model}#effort=${process.env.CLAUDE_CODE_EFFORT ?? ''}`)
      ?.effort ??
    undefined;
  return effort ? { model, effort } : { model };
}

/**
 * Spawn `claude -p` and return the full response.
 * Prompt is piped via stdin to avoid OS argument length limits.
 */
export async function executeClaudeCode(
  systemPrompt: string,
  prompt: string,
  opts?: ClaudeCodeOptions
): Promise<ClaudeCodeResponse> {
  const selection = resolveSelection(opts);
  const model = selection.model;
  const timeoutMs = opts?.timeoutMs || 600_000;

  const args = buildArgs(model, systemPrompt, { ...opts, effort: selection.effort });

  logger.info('claude-code: executing', {
    model,
    effort: selection.effort ?? '(configured default)',
    promptLength: String(prompt.length),
    webSearch: String(!!opts?.useWebSearch),
  });

  // Strip CLAUDECODE to prevent "cannot launch inside another session".
  // Set HOME to the writable claude runtime dir (created from CLAUDE_CODE_CREDENTIALS_JSON
  // or falling back to CLAUDE_HOME) so the CLI can read credentials and write session data.
  const { CLAUDECODE: _, ...baseEnv } = process.env;
  const claudeHome = ensureClaudeHome();
  const cleanEnv = claudeHome ? { ...baseEnv, HOME: claudeHome } : baseEnv;

  return new Promise((resolve, reject) => {
    const { command, args: spawnArgs } = buildAgentInvocation('claude', args, getClaudeSshHost());
    const child = spawn(command, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv,
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`claude-code: timed out after ${timeoutMs}ms`));
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
        logger.error('claude-code: non-zero exit', { code: String(code), stderr });
        reject(new Error(`claude-code: exited with code ${code} — ${stderr.slice(0, 500)}`));
        return;
      }

      const content = stdout.trim();
      if (!content) {
        const detail = stderr.trim().slice(0, 300) || '(empty)';
        logger.error('claude-code: exited cleanly but produced no output', {
          bufferRemainder: detail,
        });
        reject(new Error(`claude-code: no output produced (empty response). Buffer: ${detail}`));
        return;
      }

      resolve({ content, inputTokens: 0, outputTokens: 0 });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        new Error(`claude-code: failed to spawn — ${err.message}. Is the 'claude' CLI installed?`)
      );
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Spawn `claude -p` with stream-json output and yield text chunks.
 * Parses newline-delimited JSON from stdout, yielding text content as it arrives.
 */
export async function* streamClaudeCode(
  systemPrompt: string,
  prompt: string,
  opts?: ClaudeCodeOptions
): AsyncGenerator<string> {
  const selection = resolveSelection(opts);
  const model = selection.model;
  const timeoutMs = opts?.timeoutMs || 600_000;

  const args = ['-p', '--model', model, '--output-format', 'stream-json', '--verbose'];
  if (selection.effort) args.push('--effort', selection.effort);
  if (systemPrompt) args.push('--system-prompt', systemPrompt);
  if (opts?.useWebSearch) args.push('--allowedTools', 'WebSearch,WebFetch');

  logger.info('claude-code: streaming', {
    model,
    effort: selection.effort ?? '(configured default)',
    promptLength: String(prompt.length),
    webSearch: String(!!opts?.useWebSearch),
  });

  // Strip CLAUDECODE to prevent "cannot launch inside another session".
  // Set HOME to the writable claude runtime dir so the CLI can read credentials
  // and write session data without hitting read-only or permission errors.
  const { CLAUDECODE: _, ...baseEnv } = process.env;
  const claudeHome = ensureClaudeHome();
  const cleanEnv = claudeHome ? { ...baseEnv, HOME: claudeHome } : baseEnv;

  const { command, args: spawnArgs } = buildAgentInvocation('claude', args, getClaudeSshHost());
  const child = spawn(command, spawnArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: cleanEnv,
  });

  const timer = setTimeout(() => {
    child.kill('SIGTERM');
  }, timeoutMs);

  // Capture stderr for error reporting
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  // Track process exit code (non-blocking — captured via listener)
  let exitCode: number | null = null;
  child.on('close', (code) => {
    exitCode = code;
  });

  child.stdin.write(prompt);
  child.stdin.end();

  let buffer = '';
  let hasDeltas = false;
  let consecutiveParseFailures = 0;

  try {
    for await (const chunk of child.stdout) {
      buffer += chunk.toString();

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const raw = JSON.parse(line);
          // Unwrap stream_event envelope if present
          const event = raw.type === 'stream_event' && raw.event ? raw.event : raw;

          if (event.type === 'content_block_delta' && event.delta?.text) {
            hasDeltas = true;
            yield event.delta.text;
          } else if (event.type === 'result' && !hasDeltas) {
            // Fallback: yield complete result only if no deltas were received
            const text = typeof event.result === 'string' ? event.result : '';
            if (text) {
              hasDeltas = true;
              yield text;
            }
          } else if (event.type === 'assistant' && !hasDeltas) {
            // Fallback: extract text from assistant message content blocks
            const blocks = event.message?.content ?? event.content;
            if (Array.isArray(blocks)) {
              for (const block of blocks) {
                if (block.type === 'text' && block.text) {
                  hasDeltas = true;
                  yield block.text;
                }
              }
            }
          }
        } catch {
          // Not valid JSON — skip partial lines
          consecutiveParseFailures++;
          if (consecutiveParseFailures >= 10) {
            logger.warn('claude-code: repeated JSON parse failures in stream', {
              consecutiveParseFailures: String(consecutiveParseFailures),
              sample: line.slice(0, 200),
            });
          }
          continue;
        }
        consecutiveParseFailures = 0;
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const raw = JSON.parse(buffer);
        const event = raw.type === 'stream_event' && raw.event ? raw.event : raw;
        if (event.type === 'content_block_delta' && event.delta?.text) {
          hasDeltas = true;
          yield event.delta.text;
        } else if (event.type === 'result' && !hasDeltas) {
          const text = typeof event.result === 'string' ? event.result : '';
          if (text) {
            hasDeltas = true;
            yield text;
          }
        } else if (event.type === 'assistant' && !hasDeltas) {
          const blocks = event.message?.content ?? event.content;
          if (Array.isArray(blocks)) {
            for (const block of blocks) {
              if (block.type === 'text' && block.text) {
                hasDeltas = true;
                yield block.text;
              }
            }
          }
        }
      } catch {
        // Final chunk wasn't JSON — yield raw if non-empty
        if (buffer.trim()) {
          yield buffer.trim();
        }
      }
    }

    // Surface errors when no text was produced
    if (!hasDeltas) {
      if (exitCode !== null && exitCode !== 0) {
        const errorMsg = stderr.trim() || `claude-code exited with code ${exitCode}`;
        logger.error('claude-code: stream failed', {
          exitCode: String(exitCode),
          stderr: stderr.slice(0, 500),
        });
        throw new Error(errorMsg);
      } else if (stderr.trim()) {
        logger.error('claude-code: stream produced no output', { stderr: stderr.slice(0, 500) });
        throw new Error(stderr.trim());
      } else {
        // Exit 0, no stderr, no output — this is the empty-response failure mode
        const detail = buffer.trim().slice(0, 300) || '(empty)';
        logger.error('claude-code: exited cleanly but produced no output', {
          bufferRemainder: detail,
        });
        throw new Error(`claude-code: no output produced (empty response). Buffer: ${detail}`);
      }
    }
  } finally {
    clearTimeout(timer);
    child.kill('SIGTERM');
  }
}
