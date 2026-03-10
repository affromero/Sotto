import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

type KineticMode = 'word-by-word' | 'stagger' | 'typewriter';

interface KineticTextProps {
  text: string;
  mode?: KineticMode;
  style?: React.CSSProperties;
  /** Frames per word/char reveal (default: 4) */
  revealRate?: number;
}

/**
 * Animated text reveal with three modes:
 * - word-by-word: each word fades in sequentially with slight Y offset
 * - stagger: all words visible but stagger their opacity
 * - typewriter: character-by-character reveal with cursor
 */
export const KineticText: React.FC<KineticTextProps> = ({
  text,
  mode = 'word-by-word',
  style,
  revealRate = 4,
}) => {
  const frame = useCurrentFrame();

  if (mode === 'typewriter') {
    return <TypewriterText text={text} style={style} revealRate={revealRate} frame={frame} />;
  }

  const words = text.split(/\s+/);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3em', ...style }}>
      {words.map((word, i) => {
        const wordStartFrame = i * revealRate;

        if (mode === 'stagger') {
          const opacity = interpolate(
            frame,
            [wordStartFrame, wordStartFrame + revealRate * 2],
            [0.2, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );
          return (
            <span key={i} style={{ opacity }}>
              {word}
            </span>
          );
        }

        // word-by-word: fade in + Y offset
        const progress = interpolate(
          frame,
          [wordStartFrame, wordStartFrame + revealRate * 2],
          [0, 1],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        );
        const opacity = progress;
        const translateY = interpolate(progress, [0, 1], [8, 0]);

        return (
          <span
            key={i}
            style={{
              opacity,
              transform: `translateY(${translateY}px)`,
              display: 'inline-block',
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};

const TypewriterText: React.FC<{
  text: string;
  style?: React.CSSProperties;
  revealRate: number;
  frame: number;
}> = ({ text, style, revealRate, frame }) => {
  const { fps } = useVideoConfig();
  const charsVisible = Math.min(text.length, Math.floor(frame / revealRate));
  const visibleText = text.slice(0, charsVisible);

  // Cursor blinks every 0.5 seconds
  const cursorVisible = Math.floor(frame / (fps * 0.5)) % 2 === 0;
  const showCursor = charsVisible < text.length;

  return (
    <span style={style}>
      {visibleText}
      {showCursor && (
        <span style={{ opacity: cursorVisible ? 1 : 0 }}>|</span>
      )}
    </span>
  );
};
