import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.fn();

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const mocked = { ...actual, spawn: (...args: unknown[]) => mockSpawn(...args) };
  return { ...mocked, default: mocked };
});

vi.mock('@/lib/agent-availability', () => ({ getCodexSshHost: () => null }));
vi.mock('@/lib/codex-client', () => ({ codexEnvironment: () => ({ PATH: '/usr/bin' }) }));

function createProcess(
  respond: (request: Record<string, unknown>, send: (response: unknown) => void) => void
): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const send = (response: unknown) => {
    queueMicrotask(() => stdout.emit('data', Buffer.from(`${JSON.stringify(response)}\n`)));
  };
  proc.stdin = {
    write: vi.fn((line: string) => {
      respond(JSON.parse(line) as Record<string, unknown>, send);
      return true;
    }),
    end: vi.fn(),
  } as unknown as ChildProcess['stdin'];
  proc.stdout = stdout as ChildProcess['stdout'];
  proc.stderr = stderr as ChildProcess['stderr'];
  proc.kill = vi.fn();
  return proc;
}

describe('Codex App Server model discovery', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resetCodexModelDiscoveryCache } = await import('@/lib/agent-models/codex-app-server');
    resetCodexModelDiscoveryCache();
  });

  it('paginates model/list and keeps picker-visible effort metadata', async () => {
    const proc = createProcess((request, send) => {
      if (request.method === 'initialize') send({ id: 0, result: {} });
      if (request.method === 'model/list' && request.id === 1) {
        send({
          id: 1,
          result: {
            data: [
              {
                model: 'gpt-5.6-sol',
                isDefault: true,
                defaultReasoningEffort: 'high',
                supportedReasoningEfforts: [
                  { reasoningEffort: 'low' },
                  { reasoningEffort: 'ultra' },
                ],
              },
              { model: 'hidden-model', hidden: true },
            ],
            nextCursor: 'page-2',
          },
        });
      }
      if (request.method === 'model/list' && request.id === 2) {
        send({ id: 2, result: { data: [{ id: 'gpt-5.6-luna' }] } });
      }
    });
    mockSpawn.mockReturnValue(proc);

    const { discoverCodexModels } = await import('@/lib/agent-models/codex-app-server');
    await expect(discoverCodexModels()).resolves.toEqual([
      {
        model: 'gpt-5.6-sol',
        isDefault: true,
        defaultEffort: 'high',
        effortOptions: ['low', 'ultra'],
      },
      {
        model: 'gpt-5.6-luna',
        isDefault: false,
        defaultEffort: null,
        effortOptions: [],
      },
    ]);
  });

  it('reports App Server discovery errors', async () => {
    mockSpawn.mockReturnValue(
      createProcess((request, send) => {
        if (request.method === 'initialize') send({ id: 0, result: {} });
        if (request.method === 'model/list') {
          send({ id: request.id, error: { message: 'not authenticated' } });
        }
      })
    );

    const { discoverCodexModels } = await import('@/lib/agent-models/codex-app-server');
    await expect(discoverCodexModels()).rejects.toThrow(
      'Codex model discovery failed: not authenticated'
    );
  });
});
