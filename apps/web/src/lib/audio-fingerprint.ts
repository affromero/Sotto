import { executeMediaProcess } from './audio/media-process';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const SIMILARITY_THRESHOLD = 0.85;
const DURATION_TOLERANCE = 0.15; // 15% — only compare episodes within this duration range

interface FingerprintResult {
  fingerprint: number[];
  duration: number;
}

/**
 * Generate a Chromaprint audio fingerprint using fpcalc.
 * Analyzes the full audio file (not just first 120s).
 */
export async function generateFingerprint(
  audioPath: string,
  signal?: AbortSignal
): Promise<FingerprintResult> {
  const { stdout } = await executeMediaProcess(
    'fpcalc',
    ['-raw', '-json', '-length', '0', audioPath],
    { signal }
  );
  signal?.throwIfAborted();
  const result = z
    .object({
      duration: z.number().nonnegative(),
      fingerprint: z.array(z.number().int().min(-2147483648).max(4294967295)),
    })
    .parse(JSON.parse(stdout));
  return {
    // PostgreSQL Int[] stores signed words; preserve Chromaprint's exact 32 bits.
    fingerprint: result.fingerprint.map((word) => word | 0),
    duration: Math.round(result.duration),
  };
}

/**
 * Compare two Chromaprint fingerprints using bit-level hamming distance.
 * Returns similarity score from 0 (no match) to 1 (identical).
 */
export function compareFingerprints(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let matchingBits = 0;
  let totalBits = 0;

  for (let i = 0; i < len; i++) {
    // XOR to find differing bits, popcount to count them
    const xor = (a[i] ^ b[i]) >>> 0;
    const diffBits = popcount32(xor);
    matchingBits += 32 - diffBits;
    totalBits += 32;
  }

  return matchingBits / totalBits;
}

/** Count set bits in a 32-bit integer (Hamming weight) */
function popcount32(n: number): number {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

interface DuplicateCandidate {
  episodeId: string;
  similarity: number;
}

/**
 * Find duplicate episodes by comparing a fingerprint against all existing ones.
 * Pre-filters by duration (+/-15%) to reduce comparison count.
 */
export async function findDuplicates(
  fingerprint: number[],
  duration: number,
  excludeEpisodeId?: string
): Promise<DuplicateCandidate[]> {
  const minDuration = Math.round(duration * (1 - DURATION_TOLERANCE));
  const maxDuration = Math.round(duration * (1 + DURATION_TOLERANCE));

  const candidates = await prisma.audioFingerprint.findMany({
    where: {
      duration: { gte: minDuration, lte: maxDuration },
      ...(excludeEpisodeId ? { episodeId: { not: excludeEpisodeId } } : {}),
    },
    select: { episodeId: true, fingerprint: true },
  });

  const matches: DuplicateCandidate[] = [];

  for (const candidate of candidates) {
    const similarity = compareFingerprints(fingerprint, candidate.fingerprint);
    if (similarity >= SIMILARITY_THRESHOLD) {
      matches.push({ episodeId: candidate.episodeId, similarity });
      logger.info('Duplicate candidate found', {
        matchedEpisodeId: candidate.episodeId,
        similarity: similarity.toFixed(4),
      });
    }
  }

  return matches.sort((a, b) => b.similarity - a.similarity);
}

export { SIMILARITY_THRESHOLD };
