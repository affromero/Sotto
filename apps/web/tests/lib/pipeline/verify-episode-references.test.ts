import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReferenceFindMany = vi.fn();
const mockReferenceUpdate = vi.fn();
const mockResolveLearningAi = vi.fn();
const mockRunReferenceVerification = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    episode: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ aiModel: null, aiProvider: null }),
    },
    reference: {
      findMany: (...args: unknown[]) => mockReferenceFindMany(...args),
      update: (...args: unknown[]) => mockReferenceUpdate(...args),
    },
  },
}));

vi.mock('@/lib/learning-ai', () => ({
  resolveLearningAi: (...args: unknown[]) => mockResolveLearningAi(...args),
}));

vi.mock('@/lib/reference-verification/pipeline', () => ({
  runReferenceVerification: (...args: unknown[]) => mockRunReferenceVerification(...args),
}));

import { verifyEpisodeReferences } from '@/lib/reference-verification/verify-episode';

const reference = {
  id: 'ref-1',
  number: 1,
  title: 'Supported source',
  authors: 'Researcher',
  year: 2025,
  url: 'https://example.com/source',
  doi: null,
  type: 'ARTICLE',
};

describe('verifyEpisodeReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReferenceFindMany.mockResolvedValue([reference]);
    mockReferenceUpdate.mockResolvedValue({});
    mockResolveLearningAi.mockResolvedValue({
      apiKey: 'test-key',
      model: 'test-model',
      provider: 'test-provider',
    });
  });

  it('marks an episode reference verified only after the pipeline verifies it', async () => {
    mockRunReferenceVerification.mockResolvedValue({
      results: new Map([
        [
          'ref-1',
          {
            domain: 'NEWS',
            score: 0.94,
            verdict: { status: 'VERIFIED', confidence: 0.94 },
            checks: [{ layer: 'ai', passed: true, confidence: 0.95, detail: 'Supported' }],
          },
        ],
      ]),
      rejectedRefIds: new Set(),
      claimContexts: new Map(),
    });

    await expect(
      verifyEpisodeReferences('episode-1', 'user-1', 'Topic', [
        { speaker: 'HOST', text: 'Supported claim [1].' },
      ])
    ).resolves.toMatchObject({ total: 1, verified: 1, allVerified: true });

    expect(mockReferenceUpdate).toHaveBeenCalledWith({
      where: { id: 'ref-1' },
      data: expect.objectContaining({
        contentDomain: 'NEWS',
        verificationStatus: 'VERIFIED',
      }),
    });
  });

  it('fails closed and records FAILED when claim support is not verified', async () => {
    mockRunReferenceVerification.mockResolvedValue({
      results: new Map([
        [
          'ref-1',
          {
            domain: 'NEWS',
            score: 0.91,
            verdict: { status: 'REMOVED', confidence: 0.91 },
            checks: [{ layer: 'ai', passed: false, confidence: 0.9, detail: 'Unsupported' }],
          },
        ],
      ]),
      rejectedRefIds: new Set(['ref-1']),
      claimContexts: new Map(),
    });

    await expect(
      verifyEpisodeReferences('episode-1', 'user-1', 'Topic', [
        { speaker: 'HOST', text: 'Unsupported claim [1].' },
      ])
    ).resolves.toMatchObject({ verified: 0, allVerified: false });

    expect(mockReferenceUpdate).toHaveBeenCalledWith({
      where: { id: 'ref-1' },
      data: expect.objectContaining({ verificationStatus: 'FAILED' }),
    });
  });

  it('does not call an AI provider when the episode has no references', async () => {
    mockReferenceFindMany.mockResolvedValue([]);

    await expect(verifyEpisodeReferences('episode-1', 'user-1', 'Topic', [])).resolves.toEqual({
      total: 0,
      verified: 0,
      allVerified: false,
    });
    expect(mockResolveLearningAi).not.toHaveBeenCalled();
  });
});
