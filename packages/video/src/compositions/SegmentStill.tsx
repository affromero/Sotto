import React from 'react';
import { AbsoluteFill, Audio } from 'remotion';
import type { VideoSegment } from '../types';
import { resolveSegmentComponent } from './segments';

export interface SegmentStillProps {
  segment: VideoSegment;
  audioUrl?: string;
  audioStartTime?: number;
}

/**
 * Minimal composition that renders a single segment component at full resolution.
 * Used by the /still endpoint to produce first/last frame PNGs for programmatic visuals,
 * and by /clip for per-segment preview renders (optionally with audio).
 */
export const SegmentStill: React.FC<SegmentStillProps> = ({ segment, audioUrl, audioStartTime }) => {
  const Component = resolveSegmentComponent(segment.visualType);

  return (
    <AbsoluteFill style={{ backgroundColor: '#FEFCF8' }}>
      <Component segment={segment} />
      {audioUrl && (
        <Audio
          src={audioUrl}
          startFrom={Math.round((audioStartTime ?? 0) * 30)}
        />
      )}
    </AbsoluteFill>
  );
};
