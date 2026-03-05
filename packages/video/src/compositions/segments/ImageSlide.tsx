import React from 'react';
import { Img, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { VideoSegment } from '../../types';

export const ImageSlide: React.FC<{ segment: VideoSegment }> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const { assetUrl, order } = segment;

  // Ken Burns: alternate zoom direction per segment index
  const zoomDirection = order % 2 === 0 ? 1 : -1;
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.08], {
    extrapolateRight: 'clamp',
  });
  const panX = interpolate(frame, [0, durationInFrames], [0, 15 * zoomDirection], {
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
          transform: `scale(${scale}) translateX(${panX}px)`,
        }}
      />
    </div>
  );
};
