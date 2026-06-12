/**
 * Unit tests for the verify-ONLY class-references worker.
 *
 * Critical invariants:
 *  - It writes per-reference verdicts (VERIFIED / FAILED / REPLACED) without
 *    mutating the script or creating segments.
 *  - It NEVER calls createSegmentsAndQueueAudio (no double-segment defect).
 *  - Rejected refs become FAILED (kept, not removed → no renumbering).
 *  - Verification failure does not throw the class.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

const mockEpisodeFindUnique = vi.fn();
const mockScriptFindUnique = vi.fn();
const mockReferenceFindMany = vi.fn();
const mockReferenceUpdate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    episode: { findUnique: (...a: unknown[]) => mockEpisodeFindUnique(...a) },
    script: { findUnique: (...a: unknown[]) => mockScriptFindUnique(...a) },
    reference: {
      findMany: (...a: unknown[]) => mockReferenceFindMany(...a),
      update: (...a: unknown[]) => mockReferenceUpdate(...a),
    },
  },
}));

const mockResolveLearningAi = vi.fn();
vi.mock('@/lib/learning-ai', () => ({ resolveLearningAi: (...a: unknown[]) => mockResolveLearningAi(...a) }));

const mockRunReferenceVerification = vi.fn();
vi.mock('@/lib/reference-verification', () => ({
  runReferenceVerification: (...a: unknown[]) => mockRunReferenceVerification(...a),
}));

// Guard: the verify-only worker must NEVER create segments. We mock the module
// and assert it is never invoked.
const mockCreateSegmentsAndQueueAudio = vi.fn();
vi.mock('@/lib/segment-creator', () => ({
  createSegmentsAndQueueAudio: (...a: unknown[]) => mockCreateSegmentsAndQueueAudio(...a),
}));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { processVerifyClassReferences } from '@/workers/verify-class-references.worker';

function makeJob(episodeId: string): Job<{ episodeId: string }> {
  return { data: { episodeId } } as Job<{ episodeId: string }>;
}

const TURNS = [{ speaker: 'HOST', text: 'Hola [1] mundo [2].' }];

function ref(id: string, number: number) {
  return {
    id,
    number,
    title: `Ref ${number}`,
    authors: ['Author'],
    year: 2020,
    url: `https://example.org/${number}`,
    doi: null,
    type: 'ARTICLE',
    publisher: 'example.org',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveLearningAi.mockResolvedValue({ provider: 'anthropic', model: 'm', apiKey: 'k' });
  mockReferenceUpdate.mockResolvedValue({});
  mockEpisodeFindUnique.mockResolvedValue({ userId: 'u1', topic: 'Science', title: 'Class' });
  mockScriptFindUnique.mockResolvedValue({ turns: TURNS });
});

describe('processVerifyClassReferences', () => {
  it('never calls createSegmentsAndQueueAudio', async () => {
    mockReferenceFindMany.mockResolvedValue([ref('r1', 1)]);
    mockRunReferenceVerification.mockResolvedValue({
      results: new Map([['r1', { domain: 'NEWS', verdict: { status: 'VERIFIED', confidence: 0.9 }, score: 0.9, checks: [], logOddsContributions: {} }]]),
      rejectedRefIds: new Set<string>(),
      claimContexts: new Map(),
    });

    await processVerifyClassReferences(makeJob('p1'));

    expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
  });

  it('writes VERIFIED status for a verified reference', async () => {
    mockReferenceFindMany.mockResolvedValue([ref('r1', 1)]);
    mockRunReferenceVerification.mockResolvedValue({
      results: new Map([['r1', { domain: 'NEWS', verdict: { status: 'VERIFIED', confidence: 0.9 }, score: 0.91, checks: [{ layer: 'url', passed: true, confidence: 0.9, detail: 'ok' }], logOddsContributions: {} }]]),
      rejectedRefIds: new Set<string>(),
      claimContexts: new Map(),
    });

    await processVerifyClassReferences(makeJob('p1'));

    expect(mockReferenceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({ verificationStatus: 'VERIFIED', contentDomain: 'NEWS' }),
      }),
    );
  });

  it('writes FAILED for a verdict-FAILED reference (no REMOVED, kept for stable numbering)', async () => {
    mockReferenceFindMany.mockResolvedValue([ref('r1', 1)]);
    mockRunReferenceVerification.mockResolvedValue({
      results: new Map([['r1', { domain: 'GENERAL', verdict: { status: 'FAILED', confidence: 0.1 }, score: 0.1, checks: [], logOddsContributions: {} }]]),
      rejectedRefIds: new Set<string>(),
      claimContexts: new Map(),
    });

    await processVerifyClassReferences(makeJob('p1'));

    expect(mockReferenceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({ verificationStatus: 'FAILED' }),
      }),
    );
  });

  it('maps a REMOVED verdict to FAILED (never REMOVED) so citations stay stable', async () => {
    mockReferenceFindMany.mockResolvedValue([ref('r1', 1)]);
    mockRunReferenceVerification.mockResolvedValue({
      results: new Map([['r1', { domain: 'GENERAL', verdict: { status: 'REMOVED', confidence: 0.05 }, score: 0.05, checks: [], logOddsContributions: {} }]]),
      rejectedRefIds: new Set<string>(),
      claimContexts: new Map(),
    });

    await processVerifyClassReferences(makeJob('p1'));

    const call = mockReferenceUpdate.mock.calls.find((c) => (c[0] as { where: { id: string } }).where.id === 'r1');
    expect((call?.[0] as { data: { verificationStatus: string } }).data.verificationStatus).toBe('FAILED');
  });

  it('applies a REPLACED verdict with replacement fields', async () => {
    mockReferenceFindMany.mockResolvedValue([ref('r1', 1)]);
    mockRunReferenceVerification.mockResolvedValue({
      results: new Map([['r1', {
        domain: 'ACADEMIC',
        verdict: {
          status: 'REPLACED',
          confidence: 0.4,
          replacement: { title: 'Better Source', authors: ['New Author'], year: 2022, url: 'https://better.example/x', doi: '10.1/abc', publisher: 'Pub' },
        },
        score: 0.4,
        checks: [],
        logOddsContributions: {},
      }]]),
      rejectedRefIds: new Set<string>(),
      claimContexts: new Map(),
    });

    await processVerifyClassReferences(makeJob('p1'));

    expect(mockReferenceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({
          verificationStatus: 'REPLACED',
          title: 'Better Source',
          url: 'https://better.example/x',
          doi: '10.1/abc',
          originalTitle: 'Ref 1',
        }),
      }),
    );
  });

  it('maps a source-quality-rejected reference to FAILED', async () => {
    mockReferenceFindMany.mockResolvedValue([ref('r1', 1)]);
    mockRunReferenceVerification.mockResolvedValue({
      results: new Map(),
      rejectedRefIds: new Set<string>(['r1']),
      claimContexts: new Map(),
    });

    await processVerifyClassReferences(makeJob('p1'));

    expect(mockReferenceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({ verificationStatus: 'FAILED' }),
      }),
    );
    expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
  });

  it('is a no-op when there are no references', async () => {
    mockReferenceFindMany.mockResolvedValue([]);

    await processVerifyClassReferences(makeJob('p1'));

    expect(mockRunReferenceVerification).not.toHaveBeenCalled();
    expect(mockReferenceUpdate).not.toHaveBeenCalled();
  });

  it('is a no-op when the episode or script is missing', async () => {
    mockEpisodeFindUnique.mockResolvedValue(null);
    mockReferenceFindMany.mockResolvedValue([ref('r1', 1)]);

    await processVerifyClassReferences(makeJob('p1'));

    expect(mockRunReferenceVerification).not.toHaveBeenCalled();
  });

  it('does not throw when verification itself fails', async () => {
    mockReferenceFindMany.mockResolvedValue([ref('r1', 1)]);
    mockRunReferenceVerification.mockRejectedValue(new Error('AI down'));

    await expect(processVerifyClassReferences(makeJob('p1'))).resolves.toBeUndefined();
    expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
  });
});
