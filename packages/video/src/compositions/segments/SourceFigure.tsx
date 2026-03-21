import React from 'react';
import { Img, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { VideoSegment, SourceFigureMetadata } from '../../types';

export const SourceFigure: React.FC<{ segment: VideoSegment }> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const metadata = segment.metadata as SourceFigureMetadata | null;
  const figureUrl = metadata?.figureUrl || segment.assetUrl;
  const sourceLabel = metadata?.sourceLabel || '';
  const caption = metadata?.caption || '';

  // Gentle Ken Burns — subtler than AI illustrations to keep source figures legible
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.05], {
    extrapolateRight: 'clamp',
  });

  // Attribution fade in
  const labelOpacity = interpolate(frame, [15, 30], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  if (!figureUrl) {
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
          Figure not available
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
        backgroundColor: '#FEFCF8',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* Figure image */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 40,
          overflow: 'hidden',
        }}
      >
        <Img
          src={figureUrl}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            transform: `scale(${scale})`,
            borderRadius: 8,
            boxShadow: '0 4px 24px rgba(0, 0, 0, 0.12)',
          }}
        />
      </div>

      {/* Attribution overlay */}
      {(sourceLabel || caption) && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '16px 24px',
            background: 'linear-gradient(transparent, rgba(0, 0, 0, 0.7))',
            opacity: labelOpacity,
          }}
        >
          {caption && (
            <p
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 18,
                color: '#FFFFFF',
                margin: 0,
                marginBottom: sourceLabel ? 4 : 0,
                lineHeight: 1.4,
              }}
            >
              {caption}
            </p>
          )}
          {sourceLabel && (
            <p
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 14,
                color: 'rgba(255, 255, 255, 0.75)',
                margin: 0,
                lineHeight: 1.3,
              }}
            >
              {sourceLabel}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
