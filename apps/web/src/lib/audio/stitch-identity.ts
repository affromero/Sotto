import { createHash } from 'crypto';

export function createInitialStitchKey(fingerprint: string): string {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Invalid initial stitching fingerprint');
  return createHash('sha256').update(`sotto-initial-stitch-v2\n${fingerprint}`).digest('hex');
}

export interface StitchSegmentIdentity {
  id: string;
  version: number;
  audioUrl: string | null;
}

export function createStitchKey(
  episodeId: string,
  segments: StitchSegmentIdentity[],
  skipSfx = false
): string {
  return createHash('sha256')
    .update(
      `${episodeId}\n${segments
        .map((segment) => `${segment.id}:${segment.version}:${segment.audioUrl}`)
        .join('\n')}\n${String(skipSfx)}`
    )
    .digest('hex');
}
