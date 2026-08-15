import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.fn();

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const mocked = { ...actual, spawn: (...args: unknown[]) => mockSpawn(...args) };
  return { ...mocked, default: mocked };
});

function processResult(code: number, stdout = '', stderr = ''): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  const out = new EventEmitter();
  const err = new EventEmitter();
  proc.stdout = out as ChildProcess['stdout'];
  proc.stderr = err as ChildProcess['stderr'];
  proc.kill = vi.fn();
  queueMicrotask(() => {
    if (stdout) out.emit('data', Buffer.from(stdout));
    if (stderr) err.emit('data', Buffer.from(stderr));
    proc.emit('close', code);
  });
  return proc;
}

describe('agent readiness', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    const { resetAgentStatusCache } = await import('@/lib/agent-availability');
    resetAgentStatusCache();
  });

  it('distinguishes an installed CLI that needs authentication', async () => {
    mockSpawn
      .mockImplementationOnce(() => processResult(0, 'codex-cli 1.2.3'))
      .mockImplementationOnce(() => processResult(1, '', 'Not logged in'));

    const { getAgentStatus } = await import('@/lib/agent-availability');
    await expect(getAgentStatus('codex')).resolves.toEqual({
      readiness: 'not_authenticated',
      version: 'codex-cli 1.2.3',
      detail: 'Not logged in',
    });
  });

  it('reports a failed local version probe as not installed', async () => {
    mockSpawn.mockImplementationOnce(() => processResult(1, '', 'command not found'));

    const { getAgentStatus } = await import('@/lib/agent-availability');
    await expect(getAgentStatus('claude-code')).resolves.toMatchObject({
      readiness: 'not_installed',
      version: null,
    });
  });

  it('reports a failed SSH version probe as unreachable', async () => {
    vi.stubEnv('CODEX_SSH_HOST', 'agent@example.test');
    mockSpawn.mockImplementationOnce(() => processResult(255, '', 'Host key verification failed'));

    const { getAgentStatus } = await import('@/lib/agent-availability');
    await expect(getAgentStatus('codex')).resolves.toMatchObject({
      readiness: 'unreachable',
      detail: 'Host key verification failed',
    });
    expect(mockSpawn.mock.calls[0]?.[0]).toBe('ssh');
  });
});
