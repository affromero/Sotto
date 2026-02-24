import { spawn } from 'child_process';
import { logger } from './logger';

interface ClaudeCodeResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

interface ClaudeCodeOptions {
  model?: string;
  timeoutMs?: number;
}

/**
 * Convert a message array into a single prompt string for the CLI.
 * Single user message returns content directly.
 * Multi-turn formats as labeled turns separated by `---`.
 */
export function serializeMessages(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  if (messages.length === 1) {
    return messages[0].content;
  }

  return messages
    .map((m) => {
      const label = m.role === 'user' ? 'USER' : 'ASSISTANT';
      return `${label}: ${m.content}`;
    })
    .join('\n\n---\n\n');
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
  const model = opts?.model || process.env.CLAUDE_CODE_MODEL || 'opus';
  const timeoutMs = opts?.timeoutMs || 600_000;

  const args = ['-p', '--model', model, '--output-format', 'text'];

  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }

  logger.info('claude-code: executing', { model, promptLength: String(prompt.length) });

  // Strip CLAUDECODE env var to prevent "cannot launch inside another session" errors
  const { CLAUDECODE: _, ...cleanEnv } = process.env;

  return new Promise<ClaudeCodeResponse>((resolve, reject) => {
    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`claude-code: timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        new Error(`claude-code: failed to spawn — ${err.message}. Is the 'claude' CLI installed?`)
      );
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        logger.error('claude-code: non-zero exit', { code: String(code), stderr });
        reject(new Error(`claude-code: exited with code ${code} — ${stderr.slice(0, 500)}`));
        return;
      }

      resolve({
        content: stdout.trim(),
        inputTokens: 0,
        outputTokens: 0,
      });
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
  const model = opts?.model || process.env.CLAUDE_CODE_MODEL || 'opus';
  const timeoutMs = opts?.timeoutMs || 600_000;

  const args = ['-p', '--model', model, '--output-format', 'stream-json', '--verbose'];

  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }

  logger.info('claude-code: streaming', { model, promptLength: String(prompt.length) });

  // Strip CLAUDECODE env var to prevent "cannot launch inside another session" errors
  const { CLAUDECODE: _, ...cleanEnv } = process.env;

  const child = spawn('claude', args, {
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
        logger.error('claude-code: stream failed', { exitCode: String(exitCode), stderr: stderr.slice(0, 500) });
        throw new Error(errorMsg);
      } else if (stderr.trim()) {
        logger.error('claude-code: stream produced no output', { stderr: stderr.slice(0, 500) });
        throw new Error(stderr.trim());
      } else {
        // Exit 0, no stderr, no output — this is the empty-response failure mode
        const detail = buffer.trim().slice(0, 300) || '(empty)';
        logger.error('claude-code: exited cleanly but produced no output', { bufferRemainder: detail });
        throw new Error(`claude-code: no output produced (empty response). Buffer: ${detail}`);
      }
    }
  } finally {
    clearTimeout(timer);
    child.kill('SIGTERM');
  }
}
