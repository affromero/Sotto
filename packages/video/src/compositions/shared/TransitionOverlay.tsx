import React from 'react';
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, interpolate } from 'remotion';

const FADE_FRAMES = 6;

export const TransitionOverlay: React.FC<{
  src: string;
  durationInFrames: number;
}> = ({ src, durationInFrames }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    frame,
    [0, FADE_FRAMES, durationInFrames - FADE_FRAMES, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill style={{ opacity, zIndex: 10 }}>
      <OffthreadVideo
        src={src}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </AbsoluteFill>
  );
};
