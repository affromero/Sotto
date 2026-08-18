import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.fn();
const mockReadFileSync = vi.fn((_path?: unknown, _options?: unknown) => 'Codex says hi');
const mockUnlinkSync = vi.fn((_path?: unknown) => undefined);

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const mocked = {
    ...actual,
    spawn: (...args: unknown[]) => mockSpawn(...args),
  };
  return { ...mocked, default: mocked };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const mocked = {
    ...actual,
    readFileSync: (...args: [unknown, unknown?]) => mockReadFileSync(...args),
    unlinkSync: (...args: [unknown]) => mockUnlinkSync(...args),
  };
  return { ...mocked, default: mocked };
});

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createMockProcess(): ChildProcess & {
  _stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  _stdout: EventEmitter;
  _stderr: EventEmitter;
} {
  const proc = new EventEmitter() as ChildProcess & {
    _stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    _stdout: EventEmitter;
    _stderr: EventEmitter;
  };
  proc._stdin = { write: vi.fn(), end: vi.fn() };
  proc._stdout = new EventEmitter();
  proc._stderr = new EventEmitter();
  proc.stdin = proc._stdin as unknown as ChildProcess['stdin'];
  proc.stdout = proc._stdout as unknown as ChildProcess['stdout'];
  proc.stderr = proc._stderr as unknown as ChildProcess['stderr'];
  proc.kill = vi.fn();
  return proc;
}

describe('codex-client', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('passes dynamic model and effort selectors to codex exec', async () => {
    process.env.DATABASE_URL = 'must-not-reach-codex';
    process.env.CODEX_API_KEY = 'codex-provider-key';
    const { executeCodex } = await import('@/lib/codex-client');
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = executeCodex('System', 'Prompt', {
      model: 'codex:gpt-5.5#effort=xhigh',
    });
    proc.emit('close', 0);
    await expect(promise).resolves.toMatchObject({ content: 'Codex says hi' });

    const [command, args, options] = mockSpawn.mock.calls[0] as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect(command).toBe('codex');
    expect(args).toEqual(
      expect.arrayContaining([
        'exec',
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        '-s',
        'read-only',
        '-m',
        'gpt-5.5',
        '-c',
        'model_reasoning_effort="xhigh"',
      ])
    );
    expect(options.env.CODEX_API_KEY).toBe('codex-provider-key');
    expect(options.env.DATABASE_URL).toBeUndefined();
    expect(proc._stdin.write).toHaveBeenCalledWith('System\n\nPrompt');
  });

  it('disables codex shell snapshots for exec calls', async () => {
    const { executeCodex } = await import('@/lib/codex-client');
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = executeCodex('System', 'Prompt');
    proc.emit('close', 0);
    await promise;

    const [, args] = mockSpawn.mock.calls[0] as [string, string[]];
    expect(args).toEqual(expect.arrayContaining(['-c', 'features.shell_snapshot=false']));
  });

  it('surfaces a usage-limit failure as an actionable switch-model message', async () => {
    const { executeCodex } = await import('@/lib/codex-client');
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = executeCodex('System', 'Prompt');
    proc._stderr.emit(
      'data',
      Buffer.from(
        'ERROR codex_core::shell_snapshot: Shell snapshot validation failed\n' +
          'OpenAI Codex v0.144.6\n--------\n' +
          "ERROR: You've hit your usage limit. Visit settings to purchase more credits or try again at Aug 20th, 2026 2:09 PM."
      )
    );
    proc.emit('close', 1);

    await expect(promise).rejects.toThrow(/usage limit.*Aug 20th, 2026 2:09 PM.*Settings/s);
  });

  it('uses CODEX_MODEL and CODEX_MODEL_REASONING_EFFORT for the bare codex sentinel', async () => {
    process.env.CODEX_MODEL = 'gpt-5.6';
    process.env.CODEX_MODEL_REASONING_EFFORT = 'high';
    const { executeCodex } = await import('@/lib/codex-client');
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = executeCodex('', 'Prompt', { model: 'codex' });
    proc.emit('close', 0);
    await expect(promise).resolves.toMatchObject({ content: 'Codex says hi' });

    const [, args] = mockSpawn.mock.calls[0] as [string, string[]];
    expect(args).toEqual(
      expect.arrayContaining(['-m', 'gpt-5.6', '-c', 'model_reasoning_effort="high"'])
    );
  });

  it('enables native web search only for opted-in turns', async () => {
    const { executeCodex } = await import('@/lib/codex-client');
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const promise = executeCodex('', 'Research', { useWebSearch: true });
    proc.emit('close', 0);
    await promise;

    const [, args] = mockSpawn.mock.calls[0] as [string, string[]];
    expect(args).toContain('web_search="live"');
  });

  it('forwards progressive codex stdout chunks', async () => {
    const { streamCodex } = await import('@/lib/codex-client');
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const chunksPromise = (async () => {
      const chunks: string[] = [];
      for await (const chunk of streamCodex('', 'Prompt')) chunks.push(chunk);
      return chunks;
    })();
    await Promise.resolve();
    proc._stdout.emit('data', Buffer.from('First '));
    proc._stdout.emit('data', Buffer.from('second'));
    proc.emit('close', 0);

    await expect(chunksPromise).resolves.toEqual(['First ', 'second']);
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]];
    expect(args).not.toContain('-o');
  });
});
