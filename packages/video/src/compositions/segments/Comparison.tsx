import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { VideoSegment } from '../../types';

export const Comparison: React.FC<{ segment: VideoSegment }> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { metadata } = segment;

  const leftLabel = (metadata?.leftLabel as string) ?? 'Option A';
  const rightLabel = (metadata?.rightLabel as string) ?? 'Option B';
  const leftItems = (metadata?.leftItems as string[]) ?? [];
  const rightItems = (metadata?.rightItems as string[]) ?? [];

  const headerOpacity = interpolate(frame, [0, fps * 0.3], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const maxItems = Math.max(leftItems.length, rightItems.length);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 60,
        backgroundColor: '#FEFCF8',
      }}
    >
      <div
        style={{
          display: 'flex',
          width: '100%',
          maxWidth: 1000,
          gap: 40,
          opacity: headerOpacity,
        }}
      >
        {/* Left column */}
        <div style={{ flex: 1 }}>
          <h3
            style={{
              fontFamily: 'DM Serif Display, serif',
              fontSize: 32,
              color: '#D97706',
              marginBottom: 24,
              textAlign: 'center',
            }}
          >
            {leftLabel}
          </h3>
          {leftItems.map((item, i) => {
            const itemOpacity = interpolate(
              frame,
              [fps * 0.5 + i * (fps * 0.3), fps * 0.5 + (i + 1) * (fps * 0.3)],
              [0, 1],
              { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
            );
            const slideX = interpolate(
              frame,
              [fps * 0.5 + i * (fps * 0.3), fps * 0.5 + (i + 1) * (fps * 0.3)],
              [-20, 0],
              { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
            );
            return (
              <div
                key={i}
                style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 22,
                  color: '#1A1A1A',
                  padding: '12px 16px',
                  marginBottom: 8,
                  backgroundColor: '#FFFFFF',
                  borderRadius: 8,
                  borderLeft: '3px solid #D97706',
                  opacity: itemOpacity,
                  transform: `translateX(${slideX}px)`,
                }}
              >
                {item}
              </div>
            );
          })}
        </div>

        {/* Divider */}
        <div
          style={{
            width: 2,
            backgroundColor: '#E5E7EB',
            marginTop: 60,
            marginBottom: 20,
          }}
        />

        {/* Right column */}
        <div style={{ flex: 1 }}>
          <h3
            style={{
              fontFamily: 'DM Serif Display, serif',
              fontSize: 32,
              color: '#1E3A5F',
              marginBottom: 24,
              textAlign: 'center',
            }}
          >
            {rightLabel}
          </h3>
          {rightItems.map((item, i) => {
            const delay = fps * 0.5 + (i + maxItems) * (fps * 0.3);
            const itemOpacity = interpolate(frame, [delay, delay + fps * 0.3], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            const slideX = interpolate(frame, [delay, delay + fps * 0.3], [20, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            return (
              <div
                key={i}
                style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 22,
                  color: '#1A1A1A',
                  padding: '12px 16px',
                  marginBottom: 8,
                  backgroundColor: '#FFFFFF',
                  borderRadius: 8,
                  borderLeft: '3px solid #1E3A5F',
                  opacity: itemOpacity,
                  transform: `translateX(${slideX}px)`,
                }}
              >
                {item}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
