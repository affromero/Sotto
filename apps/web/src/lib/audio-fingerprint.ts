import { executeMediaProcess } from './audio/media-process';
import { z } from 'zod';

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
