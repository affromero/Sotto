import React from 'react';
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { VideoSegment } from '../../types';

interface MapSlideProps {
  segment: VideoSegment;
}

export const MapSlide: React.FC<MapSlideProps> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const metadata = segment.metadata as {
    places?: Array<{
      name: string;
      modernRegion?: string;
      confidence?: number;
      historicalContext?: Array<{ periodName: string }>;
    }>;
    preset?: string;
  } | undefined;
  const place = metadata?.places?.[0];
  const placeName = place?.name ?? '';
  const subtitle = place?.historicalContext?.[0]?.periodName ?? place?.modernRegion ?? '';
  const isHighConfidence = (place?.confidence ?? 1) >= 0.7;

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
            padding: '10px 20px',
            borderRadius: 8,
            borderLeft: `4px ${isHighConfidence ? 'solid' : 'dashed'} #D97706`,
          }}
        >
          <div style={{ fontFamily: 'DM Serif Display, serif', fontSize: 28 }}>
            {placeName}
          </div>
          {subtitle && (
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 16, color: '#9CA3AF', marginTop: 4 }}>
              {subtitle}
            </div>
          )}
        </div>
      )}
    </AbsoluteFill>
  );
};
