import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizedLearnerExecution } from '../../helpers/runtime/provider-execution';

const boundary = vi.hoisted(() => ({ resolve: vi.fn(), storage: vi.fn(), recordUse: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: {} }));
vi.mock('@/lib/sidedoor/access/state/transaction', () => ({
  sottoTransaction: (_database: unknown, operation: (tx: unknown) => unknown) => operation({}),
}));
vi.mock('@/lib/sidedoor/credentials/runtime/provider-credentials', () => ({
  resolveSottoProfileCredential: boundary.resolve,
  sottoCredentialStorage: boundary.storage,
}));

import { getVisualCueKey } from '@/lib/visual-cue-keys';

describe('visual cue credential admission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.resolve.mockResolvedValue({
      credential: {
        values: { apiKey: 'test-key' },
        owner: { kind: 'instance' },
        credentialRevision: 'revision',
      },
    });
    boundary.storage.mockResolvedValue({
      slot: { provider: 'pexels' },
      owned: { recordUse: boundary.recordUse },
    });
  });

  it('does not resolve or record a credential after access is revoked', async () => {
    const execution = {
      userId: 'u1',
      authorize: async () => {
        throw new Error('Access revoked');
      },
    };
    await expect(getVisualCueKey('u1', 'pexels', execution)).rejects.toThrow('Access revoked');
    expect(boundary.resolve).not.toHaveBeenCalled();
    expect(boundary.recordUse).not.toHaveBeenCalled();
  });

  it('resolves the admitted learner credential and records its use', async () => {
    await expect(getVisualCueKey('u1', 'pexels', authorizedLearnerExecution('u1'))).resolves.toBe(
      'test-key'
    );
    expect(boundary.recordUse).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'pexels', owner: { kind: 'instance' } }),
      'revision',
      expect.any(Number)
    );
  });
});
