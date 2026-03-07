import React from 'react';
import { Img, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { VideoSegment } from '../../types';

export const ImageSlide: React.FC<{ segment: VideoSegment }> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const { assetUrl, order } = segment;

  // Ken Burns: 4 preset directions cycling by segment order
  const preset = order % 4;
  const scaleFrom = preset < 2 ? 1 : 1.12;
  const scaleTo = preset < 2 ? 1.12 : 1;
  const panXDir = preset % 2 === 0 ? 1 : -1;
  const panYDir = preset < 2 ? 1 : -1;

  const scale = interpolate(frame, [0, durationInFrames], [scaleFrom, scaleTo], {
    extrapolateRight: 'clamp',
  });
  const panX = interpolate(frame, [0, durationInFrames], [0, 20 * panXDir], {
    extrapolateRight: 'clamp',
  });
  const panY = interpolate(frame, [0, durationInFrames], [0, 10 * panYDir], {
    extrapolateRight: 'clamp',
  });

  if (!assetUrl) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#FEFCF8',
        }}
      >
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 24, color: '#6B7280' }}>
          No image available
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: '#1A1A1A',
      }}
    >
      <Img
        src={assetUrl}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) translate(${panX}px, ${panY}px)`,
        }}
      />
    </div>
  );
};
