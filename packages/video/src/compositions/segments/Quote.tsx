import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { VideoSegment } from '../../types';

export const Quote: React.FC<{ segment: VideoSegment }> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { metadata } = segment;

  const quoteText = (metadata?.quoteText as string) ?? segment.text;
  const quoteAuthor = (metadata?.quoteAuthor as string) ?? '';

  const words = quoteText.split(' ');
  const framesPerWord = Math.max(2, Math.floor((fps * 1.5) / words.length));

  const authorOpacity = interpolate(
    frame,
    [words.length * framesPerWord, words.length * framesPerWord + fps * 0.5],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

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
      <svg width="48" height="40" viewBox="0 0 48 40" style={{ marginBottom: 12 }}>
        <path d="M0 28.8C0 18.4 4.8 9.6 14.4 2.4L18 6.4C12 11.2 9.2 16.8 9.6 23.2H16V40H0V28.8ZM28 28.8C28 18.4 32.8 9.6 42.4 2.4L46 6.4C40 11.2 37.2 16.8 37.6 23.2H44V40H28V28.8Z" fill="#D97706" />
      </svg>
      <p
        style={{
          fontFamily: 'DM Serif Display, serif',
          fontSize: 40,
          lineHeight: 1.5,
          color: '#1A1A1A',
          textAlign: 'center',
          maxWidth: 900,
        }}
      >
        {words.map((word, i) => {
          const wordOpacity = interpolate(
            frame,
            [i * framesPerWord, (i + 1) * framesPerWord],
            [0, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );
          return (
            <span key={i} style={{ opacity: wordOpacity }}>
              {word}{' '}
            </span>
          );
        })}
      </p>
      {quoteAuthor && (
        <p
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: 22,
            color: '#D97706',
            marginTop: 30,
            opacity: authorOpacity,
          }}
        >
          &mdash; {quoteAuthor}
        </p>
      )}
    </div>
  );
};
