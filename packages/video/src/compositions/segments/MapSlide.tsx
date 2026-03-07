import React from 'react';
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { VideoSegment } from '../../types';

interface MapSlideProps {
  segment: VideoSegment;
}

export const MapSlide: React.FC<MapSlideProps> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const metadata = segment.metadata as { places?: Array<{ name: string }>; preset?: string } | undefined;
  const placeName = metadata?.places?.[0]?.name ?? '';

  // Ken Burns: slow zoom in over the duration
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.08], {
    extrapolateRight: 'clamp',
  });

  // Fade in
  const opacity = interpolate(frame, [0, Math.min(fps * 0.5, durationInFrames)], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Annotation fade-in (delayed)
  const annotationOpacity = interpolate(
    frame,
    [Math.min(fps * 0.8, durationInFrames * 0.3), Math.min(fps * 1.3, durationInFrames * 0.5)],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#1a1a2e' }}>
      {segment.assetUrl && (
        <AbsoluteFill style={{ opacity, transform: `scale(${scale})` }}>
          <Img src={segment.assetUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </AbsoluteFill>
      )}
      {placeName && (
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            left: 40,
            opacity: annotationOpacity,
            background: 'rgba(0,0,0,0.7)',
            color: '#fefcf8',
            fontFamily: 'DM Serif Display, serif',
            fontSize: 28,
            padding: '10px 20px',
            borderRadius: 8,
            borderLeft: '4px solid #D97706',
          }}
        >
          {placeName}
        </div>
      )}
    </AbsoluteFill>
  );
};
