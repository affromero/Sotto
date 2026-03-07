'use client';

import { useEffect, useRef, useMemo, useCallback } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { PodcastVisuals } from '@sotto/video';
import { DEFAULT_RENDER_CONFIG, DEFAULT_BRANDING } from '@sotto/video';
import type { VisualsInput } from '@sotto/video';
import { parseTextWithCitations } from '@/lib/citation-parser';
import { findActiveIndex, buildVideoSegments, computeTotalFrames } from '@/lib/segment-utils';
import type { SegmentVisualData } from '@/lib/segment-utils';
import { getSpeakerIndex, getUniqueSpeakers } from '@/lib/speaker-colors';
import { usePlayer } from '@/components/providers/AudioPlayerProvider';
import type { SegmentData } from '@/types/podcast';
import type { ReferenceData } from '@/types/reference';
import styles from './VideoView.module.css';

interface VideoViewProps {
  segments: SegmentData[];
  segmentVisuals: SegmentVisualData[];
  references: ReferenceData[];
  currentTime: number;
  onSegmentClick?: (startTime: number) => void;
  title?: string;
}

const FPS = DEFAULT_RENDER_CONFIG.fps;

export function VideoView({
  segments,
  segmentVisuals,
  references,
  currentTime,
  onSegmentClick,
  title,
}: VideoViewProps) {
  const playerRef = useRef<PlayerRef>(null);
  const { isPlaying } = usePlayer();

  const speakers = useMemo(() => getUniqueSpeakers(segments), [segments]);
  const activeIndex = findActiveIndex(segments, currentTime);
  const activeSegment = segments[activeIndex] ?? null;

  const videoSegments = useMemo(
    () => buildVideoSegments(segments, segmentVisuals),
    [segments, segmentVisuals],
  );

  const totalFrames = useMemo(
    () => computeTotalFrames(videoSegments, FPS),
    [videoSegments],
  );

  const inputProps: VisualsInput = useMemo(
    () => ({
      segments: videoSegments,
      config: DEFAULT_RENDER_CONFIG,
      branding: DEFAULT_BRANDING,
    }),
    [videoSegments],
  );

  // Sync Remotion player frame with audio currentTime
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const targetFrame = Math.round(currentTime * FPS);
    player.seekTo(targetFrame);
  }, [currentTime]);

  // Sync play/pause
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (isPlaying) {
      player.play();
    } else {
      player.pause();
    }
  }, [isPlaying]);

  const handleSubtitleClick = useCallback(() => {
    if (onSegmentClick && activeSegment?.startTime !== null && activeSegment?.startTime !== undefined) {
      onSegmentClick(activeSegment.startTime);
    }
  }, [onSegmentClick, activeSegment]);

  const handleSubtitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && onSegmentClick && activeSegment?.startTime !== null && activeSegment?.startTime !== undefined) {
        e.preventDefault();
        onSegmentClick(activeSegment.startTime);
      }
    },
    [onSegmentClick, activeSegment],
  );

  return (
    <div className={styles.root} aria-label="Video view">
      <div className={styles.videoContainer}>
        <Player
          ref={playerRef}
          component={PodcastVisuals as React.FC}
          inputProps={inputProps}
          durationInFrames={totalFrames}
          compositionWidth={DEFAULT_RENDER_CONFIG.width}
          compositionHeight={DEFAULT_RENDER_CONFIG.height}
          fps={FPS}
          style={{ width: '100%', height: '100%' }}
          controls={false}
          aria-label={title ? `Video for ${title}` : 'Podcast video'}
        />
      </div>

      {activeSegment && (
        <div className={styles.subtitle}>
          <div
            className={styles.subtitleBlock}
            data-speaker-index={getSpeakerIndex(activeSegment.speaker, speakers)}
            onClick={handleSubtitleClick}
            role="button"
            tabIndex={0}
            onKeyDown={handleSubtitleKeyDown}
          >
            <span
              className={styles.speaker}
              data-speaker-index={getSpeakerIndex(activeSegment.speaker, speakers)}
            >
              {activeSegment.speaker}
            </span>
            <p className={styles.text}>
              {parseTextWithCitations(activeSegment.text, references)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
