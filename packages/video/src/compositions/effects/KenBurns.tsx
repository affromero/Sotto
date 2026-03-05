import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

interface KenBurnsProps {
  children: React.ReactNode;
  segmentIndex: number;
}

export const KenBurns: React.FC<KenBurnsProps> = ({ children, segmentIndex }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Alternate direction per segment index
  const direction = segmentIndex % 2 === 0 ? 1 : -1;

  const scale = interpolate(frame, [0, durationInFrames], [1, 1.08], {
    extrapolateRight: 'clamp',
  });

  const panX = interpolate(frame, [0, durationInFrames], [0, 15 * direction], {
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          transform: `scale(${scale}) translateX(${panX}px)`,
        }}
      >
        {children}
      </div>
    </div>
  );
};
