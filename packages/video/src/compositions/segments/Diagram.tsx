import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { VideoSegment } from '../../types';

export const Diagram: React.FC<{ segment: VideoSegment }> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { metadata } = segment;

  const svgContent = (metadata?.svgContent as string) ?? '';

  // Clip-path reveal from left to right
  const revealProgress = interpolate(frame, [0, durationInFrames * 0.6], [0, 100], {
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 60,
        backgroundColor: '#FEFCF8',
      }}
    >
      <div
        style={{
          maxWidth: 900,
          maxHeight: 500,
          clipPath: `inset(0 ${100 - revealProgress}% 0 0)`,
        }}
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    </div>
  );
};
