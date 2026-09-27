import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: {} }));
import {
  captureIsolatedLearningAi,
  createCapturedIsolatedClaude,
} from '@/lib/agents/isolated/isolated-learning-ai';

const image = `example.test/claude@sha256:${'a'.repeat(64)}`;
const execution = { authorize: async () => ({ userId: 'learner' }) };
afterEach(() => vi.unstubAllEnvs());
describe('captured isolated Claude configuration', () => {
  it('preserves ordinary execution when the operator has not enabled isolation', async () => {
    vi.stubEnv('SOTTO_ISOLATED_CLAUDE_IMAGE', '');
    expect(
      await captureIsolatedLearningAi('learner', 'claude-code:sonnet', execution)
    ).toBeUndefined();
  });
  it('fences an admitted isolated selection when the operator removes its image', async () => {
    vi.stubEnv('SOTTO_ISOLATED_CLAUDE_IMAGE', '');
    await expect(
      captureIsolatedLearningAi('learner', 'claude-code:claude-test-model', execution, image)
    ).rejects.toThrow('image changed after admission');
  });
  it('rejects mutable images before reading any learner credential', async () => {
    vi.stubEnv('SOTTO_ISOLATED_CLAUDE_IMAGE', 'example.test/claude:latest');
    await expect(
      captureIsolatedLearningAi('learner', 'claude-code:claude-test-model', execution)
    ).rejects.toThrow('immutable image digest');
  });
  it('rejects CLI aliases and unsupported effort at admission', async () => {
    vi.stubEnv('SOTTO_ISOLATED_CLAUDE_IMAGE', image);
    await expect(
      captureIsolatedLearningAi('learner', 'claude-code:sonnet', execution)
    ).rejects.toThrow('canonical API model ID');
    await expect(
      captureIsolatedLearningAi('learner', 'claude-code:claude-test-model#effort=ultra', execution)
    ).rejects.toThrow('effort is unsupported');
  });
  it('requires durable cleanup ownership before constructing a broker', async () => {
    await expect(
      createCapturedIsolatedClaude({
        provider: 'claude-code',
        model: 'claude-code:claude-test-model',
        isolatedImage: image,
        execution: { ...execution, userId: 'learner' },
      })
    ).rejects.toThrow('durable preparation execution workspace');
  });
});
