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
  const timeoutMs = opts?.timeoutMs || 120_000;

  const args = ['-p', '--model', model, '--output-format', 'text'];

  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }

  logger.info('claude-code: executing', { model, promptLength: String(prompt.length) });

  return new Promise<ClaudeCodeResponse>((resolve, reject) => {
    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
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
  const timeoutMs = opts?.timeoutMs || 120_000;

  const args = ['-p', '--model', model, '--output-format', 'stream-json'];

  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }

  logger.info('claude-code: streaming', { model, promptLength: String(prompt.length) });

  const child = spawn('claude', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const timer = setTimeout(() => {
    child.kill('SIGTERM');
  }, timeoutMs);

  child.stdin.write(prompt);
  child.stdin.end();

  let buffer = '';

  try {
    for await (const chunk of child.stdout) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'assistant' && event.message) {
            yield event.message;
          } else if (event.type === 'content_block_delta' && event.delta?.text) {
            yield event.delta.text;
          } else if (event.type === 'result' && event.result) {
            yield event.result;
          }
        } catch {
          // Not valid JSON — skip partial lines
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        if (event.type === 'assistant' && event.message) {
          yield event.message;
        } else if (event.type === 'content_block_delta' && event.delta?.text) {
          yield event.delta.text;
        } else if (event.type === 'result' && event.result) {
          yield event.result;
        }
      } catch {
        // Final chunk wasn't JSON — yield raw if non-empty
        if (buffer.trim()) {
          yield buffer.trim();
        }
      }
    }
  } finally {
    clearTimeout(timer);
    child.kill('SIGTERM');
  }
}
