'use client';

import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { PodcastVisuals } from '@sotto/video';
import { DEFAULT_RENDER_CONFIG, DEFAULT_BRANDING } from '@sotto/video';
import type { VisualsInput } from '@sotto/video';
import { parseTextWithCitations } from '@/lib/citation-parser';
import { findActiveIndex, buildVideoSegments, computeTotalFrames } from '@/lib/segment-utils';
import type { SegmentVisualData } from '@/lib/segment-utils';
import { getSpeakerIndex, getUniqueSpeakers } from '@/lib/speaker-colors';
import { usePlayer } from '@/components/providers/AudioPlayerProvider';
import { AvatarOverlay } from '@/components/player/AvatarOverlay';
import type { AvatarOverlayData } from '@/types/avatar';
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
  avatarOverlays?: AvatarOverlayData[];
  isOwner?: boolean;
  avatarsVisible?: boolean;
  onAvatarsVisibleChange?: (visible: boolean) => void;
  onAvatarPositionChange?: (speaker: string, pos: { posX: number; posY: number; width: number; height: number }) => void;
}

const FPS = DEFAULT_RENDER_CONFIG.fps;

export function VideoView({
  segments,
  segmentVisuals,
  references,
  currentTime,
  onSegmentClick,
  title,
  avatarOverlays,
  isOwner,
  avatarsVisible,
  onAvatarsVisibleChange,
  onAvatarPositionChange,
}: VideoViewProps) {
  const playerRef = useRef<PlayerRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { isPlaying } = usePlayer();
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Track container pixel dimensions for avatar positioning
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const readyOverlays = useMemo(
    () => (avatarOverlays ?? []).filter((o) => o.status === 'ready' && o.videoUrl),
    [avatarOverlays],
  );

  const speakers = useMemo(() => getUniqueSpeakers(segments), [segments]);
  const activeIndex = findActiveIndex(segments, currentTime);
  const activeSegment = segments[activeIndex] ?? null;
  const activeVisual = activeSegment ? segmentVisuals.find((v) => v.segmentId === activeSegment.id) : null;
  const photographer = activeVisual?.metadata?.photographer as string | undefined;

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
      <div className={styles.videoContainer} ref={containerRef}>
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
        {isOwner && readyOverlays.length > 0 && onAvatarsVisibleChange && (
          <button
            className={styles.avatarToggle}
            onClick={() => onAvatarsVisibleChange(!avatarsVisible)}
            aria-label={avatarsVisible ? 'Hide avatars' : 'Show avatars'}
            title={avatarsVisible ? 'Hide avatars' : 'Show avatars'}
          >
            {avatarsVisible ? 'Hide Avatars' : 'Show Avatars'}
          </button>
        )}
        {containerSize.width > 0 && readyOverlays.map((overlay) => (
          <AvatarOverlay
            key={overlay.id}
            videoUrl={overlay.videoUrl!}
            speaker={overlay.speaker}
            posX={overlay.posX}
            posY={overlay.posY}
            width={overlay.width}
            height={overlay.height}
            currentTime={currentTime}
            isPlaying={isPlaying}
            containerWidth={containerSize.width}
            containerHeight={containerSize.height}
            editable={isOwner ?? false}
            onPositionChange={(pos) => onAvatarPositionChange?.(overlay.speaker, pos)}
          />
        ))}
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
          {photographer && (
            <p className={styles.attribution}>
              Video: {photographer} / Pexels
            </p>
          )}
        </div>
      )}
    </div>
  );
}
