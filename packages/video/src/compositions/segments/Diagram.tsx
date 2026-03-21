import React, { useMemo } from 'react';
import { Img, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { VideoSegment } from '../../types';

export const Diagram: React.FC<{ segment: VideoSegment }> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { metadata } = segment;

  const svgContent = (metadata?.svgContent as string) ?? '';

  // Convert SVG string to a data URI for reliable rendering in headless Chrome
  const svgDataUri = useMemo(() => {
    if (!svgContent) return '';
    const encoded = encodeURIComponent(svgContent);
    return `data:image/svg+xml,${encoded}`;
  }, [svgContent]);

  // Clip-path reveal from left to right
  const revealProgress = interpolate(frame, [0, durationInFrames * 0.6], [0, 100], {
    extrapolateRight: 'clamp',
  });

  if (!svgDataUri) {
    return (
      <div style={{ width: '100%', height: '100%', backgroundColor: '#FEFCF8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 24, color: '#6B7280' }}>No diagram</p>
      </div>
    );
  }

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
      <Img
        src={svgDataUri}
        style={{
          maxWidth: 900,
          maxHeight: 500,
          clipPath: `inset(0 ${100 - revealProgress}% 0 0)`,
        }}
      />
    </div>
  );
};
