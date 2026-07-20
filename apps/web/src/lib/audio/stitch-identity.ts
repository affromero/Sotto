import { createHash } from 'crypto';

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

export function createStitchJobId(
  episodeId: string,
  segments: StitchSegmentIdentity[],
  skipSfx = false
): string {
  return `stitch-${episodeId}-${createStitchKey(episodeId, segments, skipSfx).slice(0, 24)}`;
}
