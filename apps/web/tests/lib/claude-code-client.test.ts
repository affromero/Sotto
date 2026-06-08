import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcess } from 'child_process';

// ---- Mocks ----

const mockSpawn = vi.fn();

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const mocked = {
    ...actual,
    spawn: (...args: unknown[]) => mockSpawn(...args),
  };
  return { ...mocked, default: mocked };
});

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Helper: create a fake ChildProcess with stdin/stdout/stderr
// stdout uses PassThrough (async iterable) for streamClaudeCode compatibility
function createMockProcess(): ChildProcess & {
  _stdout: PassThrough;
  _stderr: EventEmitter;
  _stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
} {
  const proc = new EventEmitter() as ChildProcess & {
    _stdout: PassThrough;
    _stderr: EventEmitter;
    _stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  };

  proc._stdout = new PassThrough();
  proc._stderr = new EventEmitter();
  proc._stdin = { write: vi.fn(), end: vi.fn() };

  proc.stdout = proc._stdout as any;
  proc.stderr = proc._stderr as any;
  proc.stdin = proc._stdin as any;
  proc.kill = vi.fn();

  return proc;
}

// ---- Tests ----

describe('claude-code-client', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('serializeMessages', () => {
    it('returns content directly for a single message', async () => {
      const { serializeMessages } = await import('@/lib/claude-code-client');

      const result = serializeMessages([{ role: 'user', content: 'Hello there' }]);

      expect(result).toBe('Hello there');
    });

    it('formats multi-turn conversations with labels', async () => {
      const { serializeMessages } = await import('@/lib/claude-code-client');

      const result = serializeMessages([
        { role: 'user', content: 'What is quantum computing?' },
        { role: 'assistant', content: 'Quantum computing uses qubits...' },
        { role: 'user', content: 'Tell me more about qubits' },
      ]);

      expect(result).toBe(
        'USER: What is quantum computing?\n\n---\n\nASSISTANT: Quantum computing uses qubits...\n\n---\n\nUSER: Tell me more about qubits'
      );
    });

    it('handles two messages correctly', async () => {
      const { serializeMessages } = await import('@/lib/claude-code-client');

      const result = serializeMessages([
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'Response' },
      ]);

      expect(result).toContain('USER: First message');
      expect(result).toContain('ASSISTANT: Response');
      expect(result).toContain('---');
    });
  });

  describe('executeClaudeCode', () => {
    it('spawns claude CLI with correct arguments', async () => {
      const { executeClaudeCode } = await import('@/lib/claude-code-client');

      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = executeClaudeCode('You are helpful.', 'Say hello');

      // Simulate successful output
      proc._stdout.emit('data', Buffer.from('Hello from Claude!'));
      proc.emit('close', 0);

      const result = await promise;

      expect(result).toEqual({
        content: 'Hello from Claude!',
        inputTokens: 0,
        outputTokens: 0,
      });
    });

    it('trims whitespace from stdout', async () => {
      const { executeClaudeCode } = await import('@/lib/claude-code-client');

      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = executeClaudeCode('System', 'Prompt');

      proc._stdout.emit('data', Buffer.from('  Hello  \n'));
      proc.emit('close', 0);

      const result = await promise;
      expect(result.content).toBe('Hello');
    });

    it('concatenates multiple stdout chunks', async () => {
      const { executeClaudeCode } = await import('@/lib/claude-code-client');

      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = executeClaudeCode('System', 'Prompt');

      proc._stdout.emit('data', Buffer.from('Part 1 '));
      proc._stdout.emit('data', Buffer.from('Part 2'));
      proc.emit('close', 0);

      const result = await promise;
      expect(result.content).toBe('Part 1 Part 2');
    });

    it('rejects on non-zero exit code', async () => {
      const { executeClaudeCode } = await import('@/lib/claude-code-client');

      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = executeClaudeCode('System', 'Prompt');

      proc._stderr.emit('data', Buffer.from('Something went wrong'));
      proc.emit('close', 1);

      await expect(promise).rejects.toThrow('claude-code: exited with code 1');
    });

    it('rejects when spawn fails (CLI not found)', async () => {
      const { executeClaudeCode } = await import('@/lib/claude-code-client');

      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = executeClaudeCode('System', 'Prompt');

      proc.emit('error', new Error('ENOENT'));

      await expect(promise).rejects.toThrow('claude-code: failed to spawn');
      await expect(promise).rejects.toThrow("Is the 'claude' CLI installed?");
    });

    it('rejects on timeout', async () => {
      vi.useFakeTimers();

      const { executeClaudeCode } = await import('@/lib/claude-code-client');

      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = executeClaudeCode('System', 'Prompt', { timeoutMs: 5000 });

      vi.advanceTimersByTime(5000);

      await expect(promise).rejects.toThrow('claude-code: timed out after 5000ms');
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

      vi.useRealTimers();
    });

  });

  describe('streamClaudeCode', () => {
    it('spawns with stream-json output format', async () => {
      const { streamClaudeCode } = await import('@/lib/claude-code-client');

      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const gen = streamClaudeCode('System', 'Prompt');

      setTimeout(() => {
        proc._stdout.write(JSON.stringify({ type: 'result', result: 'Hello' }) + '\n');
        proc._stdout.end();
      }, 0);

      const chunks: string[] = [];
      for await (const chunk of gen) {
        chunks.push(chunk);
      }

      expect(chunks).toContain('Hello');
    });

    it('yields text from content_block_delta events', async () => {
      const { streamClaudeCode } = await import('@/lib/claude-code-client');

      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const gen = streamClaudeCode('System', 'Prompt');

      setTimeout(() => {
        const event1 = JSON.stringify({ type: 'content_block_delta', delta: { text: 'Hello ' } });
        const event2 = JSON.stringify({ type: 'content_block_delta', delta: { text: 'world' } });
        proc._stdout.write(event1 + '\n' + event2 + '\n');
        proc._stdout.end();
      }, 0);

      const chunks: string[] = [];
      for await (const chunk of gen) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello ', 'world']);
    });

    it('yields text from assistant message events', async () => {
      const { streamClaudeCode } = await import('@/lib/claude-code-client');

      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const gen = streamClaudeCode('System', 'Prompt');

      setTimeout(() => {
        proc._stdout.write(
          JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'Hi there' }] },
          }) + '\n'
        );
        proc._stdout.end();
      }, 0);

      const chunks: string[] = [];
      for await (const chunk of gen) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hi there']);
    });

    it('skips events with unknown types', async () => {
      const { streamClaudeCode } = await import('@/lib/claude-code-client');

      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const gen = streamClaudeCode('System', 'Prompt');

      setTimeout(() => {
        const unknownEvent = JSON.stringify({ type: 'message_start', id: 'msg-1' });
        const textEvent = JSON.stringify({ type: 'result', result: 'Visible' });
        proc._stdout.write(unknownEvent + '\n' + textEvent + '\n');
        proc._stdout.end();
      }, 0);

      const chunks: string[] = [];
      for await (const chunk of gen) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Visible']);
    });

    it('handles chunked JSON across multiple data events', async () => {
      const { streamClaudeCode } = await import('@/lib/claude-code-client');

      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const gen = streamClaudeCode('System', 'Prompt');

      const fullLine = JSON.stringify({ type: 'result', result: 'Complete' });

      setTimeout(() => {
        proc._stdout.write(fullLine.slice(0, 10));
        proc._stdout.write(fullLine.slice(10) + '\n');
        proc._stdout.end();
      }, 0);

      const chunks: string[] = [];
      for await (const chunk of gen) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Complete']);
    });

    it('kills process on cleanup even when no output is produced', async () => {
      const { streamClaudeCode } = await import('@/lib/claude-code-client');

      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const gen = streamClaudeCode('System', 'Prompt');

      setTimeout(() => {
        proc._stdout.end();
      }, 0);

      // Generator now throws when no output is produced
      await expect(async () => {
        for await (const _chunk of gen) {
          // consume
        }
      }).rejects.toThrow('no output produced');

      // SIGTERM must still be sent via the finally block
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('remote agent (SSH)', () => {
    it('shellQuote single-quotes and escapes embedded quotes', async () => {
      const { shellQuote } = await import('@/lib/claude-code-client');
      expect(shellQuote('hello world')).toBe("'hello world'");
      expect(shellQuote("it's")).toBe("'it'\\''s'");
    });

    it('getClaudeSshHost trims the env; blank becomes undefined', async () => {
      const { getClaudeSshHost } = await import('@/lib/claude-code-client');
      process.env.CLAUDE_CODE_SSH_HOST = '  me@vps  ';
      expect(getClaudeSshHost()).toBe('me@vps');
      process.env.CLAUDE_CODE_SSH_HOST = '';
      expect(getClaudeSshHost()).toBeUndefined();
    });

    it('runs the CLI directly when no host is set', async () => {
      const { buildAgentInvocation } = await import('@/lib/claude-code-client');
      expect(buildAgentInvocation('claude', ['-p', '--model', 'm'])).toEqual({
        command: 'claude',
        args: ['-p', '--model', 'm'],
      });
    });

    it('wraps the CLI in ssh and quotes every arg when a host is set', async () => {
      const { buildAgentInvocation } = await import('@/lib/claude-code-client');
      const inv = buildAgentInvocation('claude', ['-p', '--system-prompt', 'be nice'], 'me@vps');
      expect(inv.command).toBe('ssh');
      expect(inv.args).toContain('BatchMode=yes');
      expect(inv.args[inv.args.length - 2]).toBe('me@vps');
      expect(inv.args[inv.args.length - 1]).toBe("'claude' '-p' '--system-prompt' 'be nice'");
    });

    it('executeClaudeCode spawns ssh (not claude) with the prompt still on stdin', async () => {
      process.env.CLAUDE_CODE_SSH_HOST = 'me@vps';
      const { executeClaudeCode } = await import('@/lib/claude-code-client');
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = executeClaudeCode('System', 'the user prompt');
      proc._stdout.emit('data', Buffer.from('ok'));
      proc.emit('close', 0);
      await promise;

      const [command, spawnArgs] = mockSpawn.mock.calls[0] as [string, string[]];
      expect(command).toBe('ssh');
      expect(spawnArgs[spawnArgs.length - 2]).toBe('me@vps');
      expect(spawnArgs[spawnArgs.length - 1]).toContain("'claude'");
      expect(proc._stdin.write).toHaveBeenCalledWith('the user prompt');
    });
  });
});
