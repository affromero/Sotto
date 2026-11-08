import { describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ generate: vi.fn(), validate: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: {} }));
vi.mock('@/lib/sidedoor/access/state/transaction', () => ({
  sottoTransaction: async (...args: [unknown, (database: object) => Promise<unknown>]) =>
    args[1]({}),
}));
vi.mock('@/lib/sidedoor/credentials/runtime/provider-execution', () => ({
  captureSottoProviderAdmission: async () => ({ validate: boundary.validate }),
}));
vi.mock('@/lib/learning-ai', () => ({ capturedLearningAiOptions: async () => ({}) }));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: boundary.generate }),
}));
vi.mock('@/lib/agent-availability', () => ({ getCodexSshHost: () => null }));

describe('durable CLI dispatch', () => {
  it('does not launch after the account changes during input moderation', async () => {
    boundary.generate.mockReset();
    boundary.validate.mockReset().mockResolvedValue(undefined);
    const { executeLearningCliOnce } =
      await import('@/lib/learning/preparation/provider-invocation');
    let accountChanged = false;
    const settled: string[] = [];
    const controller = new AbortController();
    const execution = { userId: 'learner', authorize: async () => ({ userId: 'learner' }) };
    let unresolved = false;
    await expect(
      executeLearningCliOnce({
        ai: { provider: 'codex', model: 'codex:fixture:high', execution },
        inputDigest: 'a'.repeat(64),
        selection: {},
        system: 'System',
        messages: [{ role: 'user', content: 'Input' }],
        options: {},
        responseLimit: 1000,
        binding: { kind: 'LOCAL_ACCOUNT', fingerprint: 'b'.repeat(64), revision: 'r' },
        signal: controller.signal,
        unresolved: () => {
          unresolved = true;
        },
        beforeDispatch: async () => {
          accountChanged = true;
        },
        operation: {
          validateBinding: async () => {
            if (accountChanged) throw new Error('Account changed');
          },
          admit: async () => ({ dispatch: true }),
          settle: async (...args) => {
            settled.push(args[2]);
          },
        },
      })
    ).rejects.toMatchObject({ outcome: 'NOT_DISPATCHED' });
    expect(boundary.generate).not.toHaveBeenCalled();
    expect(settled).toEqual(['failed']);
    expect(unresolved).toBe(false);
  });
});
