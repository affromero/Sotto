import React from 'react';
import { AbsoluteFill } from 'remotion';
import { LightLeak } from '@remotion/light-leaks';

export const LightLeakOverlay: React.FC<{
  durationInFrames: number;
  seed?: number;
  hueShift?: number;
}> = ({ durationInFrames, seed = 0, hueShift = 15 }) => {
  return (
    <AbsoluteFill style={{ zIndex: 10 }}>
      <LightLeak
        durationInFrames={durationInFrames}
        seed={seed}
        hueShift={hueShift}
      />
    </AbsoluteFill>
  );
};
