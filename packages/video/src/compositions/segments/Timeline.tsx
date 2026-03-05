import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { VideoSegment } from '../../types';

interface TimelineEvent {
  year: string;
  label: string;
  description?: string;
}

export const Timeline: React.FC<{ segment: VideoSegment }> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { metadata } = segment;

  const events = (metadata?.events as TimelineEvent[]) ?? [];
  const eventCount = events.length || 1;

  // Moving cursor progresses across the timeline over the segment duration
  const cursorProgress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const timelineWidth = 1000;

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
      {/* Timeline bar */}
      <div
        style={{
          position: 'relative',
          width: timelineWidth,
          height: 4,
          backgroundColor: '#E5E7EB',
          borderRadius: 2,
        }}
      >
        {/* Progress fill */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: `${cursorProgress * 100}%`,
            backgroundColor: '#D97706',
            borderRadius: 2,
          }}
        />

        {/* Cursor */}
        <div
          style={{
            position: 'absolute',
            top: -8,
            left: `${cursorProgress * 100}%`,
            width: 20,
            height: 20,
            borderRadius: '50%',
            backgroundColor: '#D97706',
            transform: 'translateX(-50%)',
            boxShadow: '0 2px 8px rgba(217, 119, 6, 0.4)',
          }}
        />

        {/* Events */}
        {events.map((event, i) => {
          const position = eventCount === 1 ? 0.5 : i / (eventCount - 1);
          const eventRevealFrame = (durationInFrames * position) * 0.8;
          const eventOpacity = interpolate(
            frame,
            [eventRevealFrame, eventRevealFrame + fps * 0.3],
            [0, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );

          const isAbove = i % 2 === 0;

          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${position * 100}%`,
                transform: 'translateX(-50%)',
                top: isAbove ? -120 : 30,
                textAlign: 'center',
                opacity: eventOpacity,
                width: 160,
              }}
            >
              {/* Dot on timeline */}
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: isAbove ? 112 : -22,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  backgroundColor: '#1E3A5F',
                  transform: 'translateX(-50%)',
                }}
              />
              <div
                style={{
                  fontFamily: 'DM Serif Display, serif',
                  fontSize: 20,
                  color: '#D97706',
                  fontWeight: 700,
                }}
              >
                {event.year}
              </div>
              <div
                style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 16,
                  color: '#1A1A1A',
                  fontWeight: 600,
                  marginTop: 4,
                }}
              >
                {event.label}
              </div>
              {event.description && (
                <div
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 13,
                    color: '#6B7280',
                    marginTop: 4,
                  }}
                >
                  {event.description}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
