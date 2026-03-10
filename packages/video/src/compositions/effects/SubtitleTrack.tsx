import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

type SubtitleStyle = 'default' | 'cinematic';

interface SubtitleTrackProps {
  /** Full narration text — split into ~8-word chunks automatically */
  narration: string;
  style?: SubtitleStyle;
  position?: 'bottom' | 'top';
  fontSize?: number;
  /** Highlight the current word with bold + scale pulse */
  highlightCurrentWord?: boolean;
}

/**
 * Enhanced subtitle track with:
 * - Smooth fade between chunks
 * - Optional current-word highlighting (bold + scale pulse)
 * - Styles: default (white + shadow), cinematic (box bg + larger font)
 */
export const SubtitleTrack: React.FC<SubtitleTrackProps> = ({
  narration,
  style: subStyle = 'default',
  position = 'bottom',
  fontSize = 32,
  highlightCurrentWord = false,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const words = narration.split(/\s+/);
  const chunkSize = 8;
  const chunks: string[][] = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize));
  }

  if (chunks.length === 0) return null;

  const framesPerChunk = Math.ceil(durationInFrames / chunks.length);
  const currentChunkIndex = Math.min(Math.floor(frame / framesPerChunk), chunks.length - 1);
  const chunkStartFrame = currentChunkIndex * framesPerChunk;
  const chunkEndFrame = chunkStartFrame + framesPerChunk;

  const FADE_FRAMES = 8;
  const opacity = interpolate(
    frame,
    [chunkStartFrame, chunkStartFrame + FADE_FRAMES, chunkEndFrame - FADE_FRAMES, chunkEndFrame],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const isCinematic = subStyle === 'cinematic';
  const isTop = position === 'top';
  const currentChunk = chunks[currentChunkIndex];

  // Word-level progress within the chunk (for highlighting)
  const chunkLocalFrame = frame - chunkStartFrame;
  const framesPerWord = framesPerChunk / currentChunk.length;
  const currentWordIndex = Math.min(
    Math.floor(chunkLocalFrame / framesPerWord),
    currentChunk.length - 1,
  );

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        ...(isTop ? { top: '5%' } : { bottom: '8%' }),
        display: 'flex',
        justifyContent: 'center',
        opacity,
      }}
    >
      <div
        style={{
          fontFamily: 'Inter, sans-serif',
          fontSize,
          fontWeight: isCinematic ? 700 : 400,
          color: 'white',
          textAlign: 'center',
          maxWidth: '80%',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '0.25em',
          ...(isCinematic
            ? { backgroundColor: 'rgba(0, 0, 0, 0.6)', padding: '10px 20px', borderRadius: 8 }
            : { textShadow: '2px 2px 4px rgba(0, 0, 0, 0.8)' }),
        }}
      >
        {highlightCurrentWord
          ? currentChunk.map((word, wi) => {
              const isActive = wi === currentWordIndex;
              const wordProgress = isActive
                ? interpolate(
                    chunkLocalFrame - wi * framesPerWord,
                    [0, framesPerWord * 0.5],
                    [0, 1],
                    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
                  )
                : 0;
              const scale = isActive ? interpolate(wordProgress, [0, 1], [1, 1.08]) : 1;

              return (
                <span
                  key={wi}
                  style={{
                    fontWeight: isActive ? 700 : undefined,
                    transform: `scale(${scale})`,
                    display: 'inline-block',
                    transition: 'font-weight 0.1s',
                  }}
                >
                  {word}
                </span>
              );
            })
          : currentChunk.join(' ')}
      </div>
    </div>
  );
};
