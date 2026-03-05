import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { VideoSegment } from '../../types';

export const TextCard: React.FC<{ segment: VideoSegment }> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { metadata } = segment;

  const headline = (metadata?.headline as string) ?? segment.text;
  const bullets = (metadata?.bullets as string[]) ?? [];
  const statValue = metadata?.statValue as number | undefined;
  const statLabel = (metadata?.statLabel as string) ?? '';

  const headlineOpacity = interpolate(frame, [0, fps * 0.4], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Animated stat counter
  const counterValue =
    statValue !== undefined
      ? Math.round(
          interpolate(frame, [fps * 0.3, fps * 1.5], [0, statValue], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        )
      : undefined;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 80,
        backgroundColor: '#FEFCF8',
      }}
    >
      {counterValue !== undefined && (
        <div
          style={{
            fontFamily: 'DM Serif Display, serif',
            fontSize: 72,
            color: '#D97706',
            fontWeight: 700,
            marginBottom: 8,
            opacity: headlineOpacity,
          }}
        >
          {counterValue.toLocaleString()}
        </div>
      )}
      {statLabel && counterValue !== undefined && (
        <div
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: 20,
            color: '#6B7280',
            marginBottom: 30,
            opacity: headlineOpacity,
          }}
        >
          {statLabel}
        </div>
      )}
      <h2
        style={{
          fontFamily: 'DM Serif Display, serif',
          fontSize: 40,
          color: '#1A1A1A',
          textAlign: 'center',
          maxWidth: 800,
          marginBottom: 30,
          opacity: headlineOpacity,
        }}
      >
        {headline}
      </h2>
      <ul style={{ listStyle: 'none', padding: 0, maxWidth: 700, width: '100%' }}>
        {bullets.map((bullet, i) => {
          const bulletOpacity = interpolate(
            frame,
            [fps * 0.5 + i * (fps * 0.25), fps * 0.5 + (i + 1) * (fps * 0.25)],
            [0, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );
          return (
            <li
              key={i}
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 24,
                color: '#1A1A1A',
                padding: '12px 20px',
                marginBottom: 10,
                backgroundColor: '#FFFFFF',
                borderRadius: 8,
                borderLeft: '3px solid #D97706',
                opacity: bulletOpacity,
              }}
            >
              {bullet}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
