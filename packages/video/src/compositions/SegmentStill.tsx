import React from 'react';
import { AbsoluteFill } from 'remotion';
import type { VideoSegment } from '../types';
import { resolveSegmentComponent } from './segments';

export interface SegmentStillProps {
  segment: VideoSegment;
}

/**
 * Minimal composition that renders a single segment component at full resolution.
 * Used by the /still endpoint to produce first/last frame PNGs for programmatic visuals.
 * No audio, no watermark, no speaker labels, no fade transitions.
 */
export const SegmentStill: React.FC<SegmentStillProps> = ({ segment }) => {
  const Component = resolveSegmentComponent(segment.visualType);

  return (
    <AbsoluteFill style={{ backgroundColor: '#FEFCF8' }}>
      <Component segment={segment} />
    </AbsoluteFill>
  );
};
