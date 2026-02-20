import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockVoiceFingerprintFindMany = vi.fn();
const mockVoiceFingerprintFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    voiceFingerprint: {
      findMany: (...args: unknown[]) => mockVoiceFingerprintFindMany(...args),
      findUnique: (...args: unknown[]) => mockVoiceFingerprintFindUnique(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Import under test ----

import {
  cosineSimilarity,
  findDuplicateVoiceprints,
  verifyChallenge,
} from '@/lib/voice-fingerprint';

// ---- Tests ----

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 10);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 10);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 10);
  });

  it('computes correct similarity for known vectors', () => {
    const a = [1, 0];
    const b = [1, 1];
    // cos(45deg) = sqrt(2)/2 ≈ 0.7071
    expect(cosineSimilarity(a, b)).toBeCloseTo(Math.SQRT2 / 2, 6);
  });

  it('returns 0 when one vector is all zeros', () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('throws when vectors have different dimensions', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow('Embedding dimension mismatch');
  });

  it('handles high-dimensional vectors', () => {
    const dim = 512;
    const v = Array.from({ length: dim }, (_, i) => Math.sin(i));
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 10);
  });
});

describe('findDuplicateVoiceprints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns matches above the 0.78 threshold', async () => {
    const queryEmbedding = [1, 0, 0];
    // Very similar vector (nearly identical)
    const similarEmbedding = [0.99, 0.01, 0];
    // Dissimilar vector
    const differentEmbedding = [0, 1, 0];

    mockVoiceFingerprintFindMany.mockResolvedValue([
      { voiceCloneId: 'clone-similar', embedding: similarEmbedding },
      { voiceCloneId: 'clone-different', embedding: differentEmbedding },
    ]);

    const results = await findDuplicateVoiceprints(queryEmbedding);

    expect(results).toHaveLength(1);
    expect(results[0].voiceCloneId).toBe('clone-similar');
    expect(results[0].similarity).toBeGreaterThan(0.78);
  });

  it('returns empty array when no fingerprints match', async () => {
    const queryEmbedding = [1, 0, 0];
    mockVoiceFingerprintFindMany.mockResolvedValue([
      { voiceCloneId: 'clone-1', embedding: [0, 1, 0] },
      { voiceCloneId: 'clone-2', embedding: [0, 0, 1] },
    ]);

    const results = await findDuplicateVoiceprints(queryEmbedding);

    expect(results).toHaveLength(0);
  });

  it('returns results sorted by similarity descending', async () => {
    const queryEmbedding = [1, 0, 0];
    mockVoiceFingerprintFindMany.mockResolvedValue([
      { voiceCloneId: 'clone-a', embedding: [0.95, 0.05, 0] },
      { voiceCloneId: 'clone-b', embedding: [0.99, 0.01, 0] },
    ]);

    const results = await findDuplicateVoiceprints(queryEmbedding);

    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);
    expect(results[0].voiceCloneId).toBe('clone-b');
  });

  it('excludes the given voiceCloneId from the query', async () => {
    mockVoiceFingerprintFindMany.mockResolvedValue([]);

    await findDuplicateVoiceprints([1, 0, 0], 'clone-self');

    expect(mockVoiceFingerprintFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          voiceCloneId: { not: 'clone-self' },
        }),
      })
    );
  });

  it('filters to verified/admin_verified/protected voices', async () => {
    mockVoiceFingerprintFindMany.mockResolvedValue([]);

    await findDuplicateVoiceprints([1, 0, 0]);

    expect(mockVoiceFingerprintFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          voiceClone: {
            verificationStatus: { in: ['VERIFIED', 'ADMIN_VERIFIED', 'PROTECTED'] },
          },
        }),
      })
    );
  });

  it('returns empty array when no fingerprints exist', async () => {
    mockVoiceFingerprintFindMany.mockResolvedValue([]);

    const results = await findDuplicateVoiceprints([1, 0, 0]);

    expect(results).toEqual([]);
  });
});

describe('verifyChallenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns passed=true when similarity is above 0.72', async () => {
    const liveEmbedding = [1, 0, 0];
    const storedEmbedding = [0.99, 0.01, 0];

    mockVoiceFingerprintFindUnique.mockResolvedValue({
      embedding: storedEmbedding,
    });

    const result = await verifyChallenge(liveEmbedding, 'clone-1');

    expect(result.passed).toBe(true);
    expect(result.similarity).toBeGreaterThan(0.72);
  });

  it('returns passed=false when similarity is below 0.72', async () => {
    const liveEmbedding = [1, 0, 0];
    const storedEmbedding = [0.5, 0.5, 0.707];

    mockVoiceFingerprintFindUnique.mockResolvedValue({
      embedding: storedEmbedding,
    });

    const result = await verifyChallenge(liveEmbedding, 'clone-1');

    expect(result.passed).toBe(false);
    expect(result.similarity).toBeLessThan(0.72);
  });

  it('returns passed=true at exactly the 0.72 threshold', async () => {
    // Construct vectors with exact 0.72 cosine similarity
    // cos(theta)=0.72 → a=[0.72, sqrt(1-0.72^2), 0], b=[1,0,0]
    const storedEmbedding = [1, 0, 0];
    const liveEmbedding = [0.72, Math.sqrt(1 - 0.72 * 0.72), 0];

    mockVoiceFingerprintFindUnique.mockResolvedValue({
      embedding: storedEmbedding,
    });

    const result = await verifyChallenge(liveEmbedding, 'clone-1');

    expect(result.similarity).toBeCloseTo(0.72, 6);
    expect(result.passed).toBe(true);
  });

  it('throws when no fingerprint exists for the voice clone', async () => {
    mockVoiceFingerprintFindUnique.mockResolvedValue(null);

    await expect(verifyChallenge([1, 0, 0], 'clone-missing')).rejects.toThrow(
      'No fingerprint found for voice clone clone-missing'
    );
  });

  it('looks up the fingerprint by voiceCloneId', async () => {
    mockVoiceFingerprintFindUnique.mockResolvedValue({
      embedding: [1, 0, 0],
    });

    await verifyChallenge([1, 0, 0], 'clone-abc');

    expect(mockVoiceFingerprintFindUnique).toHaveBeenCalledWith({
      where: { voiceCloneId: 'clone-abc' },
      select: { embedding: true },
    });
  });
});
