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
import { AvatarOverlay, AVATAR_MASK_SHAPES } from '@/components/player/AvatarOverlay';
import type { AvatarMaskShape } from '@/components/player/AvatarOverlay';
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
  onMaskShapeChange?: (speaker: string, shape: AvatarMaskShape) => void;
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
  onMaskShapeChange,
}: VideoViewProps) {
  const playerRef = useRef<PlayerRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { isPlaying } = usePlayer();
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [shapePickerSpeaker, setShapePickerSpeaker] = useState<string | null>(null);

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

  const playableOverlays = useMemo(
    () => (avatarOverlays ?? []).filter(
      (o) => (o.status === 'ready' && o.videoUrl) || (o.chunkVideoUrl && o.status !== 'failed'),
    ),
    [avatarOverlays],
  );

  const speakers = useMemo(() => getUniqueSpeakers(segments), [segments]);
  const activeIndex = findActiveIndex(segments, currentTime);
  const activeSegment = segments[activeIndex] ?? null;

  // Show avatar only when the matching speaker is active AND the segment is enabled
  const visibleOverlays = useMemo(() => {
    if (!activeSegment) return [];
    return playableOverlays.filter((o) => {
      if (o.speaker !== activeSegment.speaker) return false;
      // If enabledSegmentIds is set, only show on those segments
      const enabled = o.enabledSegmentIds;
      if (enabled && enabled.length > 0) return enabled.includes(activeSegment.id);
      return true;
    });
  }, [playableOverlays, activeSegment]);

  // Compute avatar video time: cumulative duration of prior enabled same-speaker segments + elapsed in current
  const avatarTimeMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!activeSegment) return map;
    for (const overlay of playableOverlays) {
      const enabled = overlay.enabledSegmentIds;
      const isEnabled = (segId: string) => !enabled || enabled.length === 0 || enabled.includes(segId);
      let avatarTime = 0;
      for (let i = 0; i < segments.length; i++) {
        if (segments[i].speaker !== overlay.speaker) continue;
        if (!isEnabled(segments[i].id)) continue;
        if (i < activeIndex) {
          avatarTime += segments[i].duration ?? 0;
        } else if (i === activeIndex) {
          avatarTime += currentTime - (segments[i].startTime ?? 0);
          break;
        }
      }
      map.set(overlay.speaker, avatarTime);
    }
    return map;
  }, [playableOverlays, segments, activeIndex, activeSegment, currentTime]);
  // Find the active sub-visual based on elapsed time within the segment
  const activeVisual = useMemo(() => {
    if (!activeSegment) return null;
    const segVisuals = segmentVisuals.filter((v) => v.segmentId === activeSegment.id);
    if (segVisuals.length <= 1) return segVisuals[0] ?? null;
    // Multiple sub-visuals — find the one matching current playback time
    const elapsed = currentTime - (activeSegment.startTime ?? 0);
    return segVisuals.find((v) =>
      elapsed >= (v.startOffset ?? 0) && elapsed < (v.startOffset ?? 0) + (v.subDuration ?? activeSegment.duration!),
    ) ?? segVisuals[0];
  }, [activeSegment, segmentVisuals, currentTime]);
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
        {isOwner && playableOverlays.length > 0 && onAvatarsVisibleChange && (
          <button
            className={styles.avatarToggle}
            onClick={() => onAvatarsVisibleChange(!avatarsVisible)}
            aria-label={avatarsVisible ? 'Hide avatars' : 'Show avatars'}
            title={avatarsVisible ? 'Hide avatars' : 'Show avatars'}
          >
            {avatarsVisible ? 'Hide Avatars' : 'Show Avatars'}
          </button>
        )}
        {avatarsVisible && containerSize.width > 0 && playableOverlays.map((overlay) => (
          <AvatarOverlay
            key={overlay.id}
            videoUrl={overlay.videoUrl ?? overlay.chunkVideoUrl!}
            maxDuration={overlay.videoUrl ? undefined : (overlay.chunkDurationSeconds ?? undefined)}
            streaming={!overlay.videoUrl && !!overlay.chunkVideoUrl}
            speaker={overlay.speaker}
            posX={overlay.posX}
            posY={overlay.posY}
            width={overlay.width}
            height={overlay.height}
            currentTime={avatarTimeMap.get(overlay.speaker) ?? 0}
            isPlaying={isPlaying && visibleOverlays.some((v) => v.id === overlay.id)}
            containerWidth={containerSize.width}
            containerHeight={containerSize.height}
            editable={isOwner ?? false}
            maskShape={(overlay.maskShape as AvatarMaskShape) ?? 'none'}
            onPositionChange={(pos) => onAvatarPositionChange?.(overlay.speaker, pos)}
            visible={visibleOverlays.some((v) => v.id === overlay.id)}
          />
        ))}
        {isOwner && avatarsVisible && playableOverlays.length > 0 && onMaskShapeChange && (
          <div className={styles.shapePicker}>
            {playableOverlays.map((overlay) => (
              <div key={overlay.id} className={styles.shapePickerRow}>
                <button
                  className={styles.shapePickerToggle}
                  onClick={() => setShapePickerSpeaker(
                    shapePickerSpeaker === overlay.speaker ? null : overlay.speaker,
                  )}
                  type="button"
                  aria-label={`Change shape for ${overlay.avatarName ?? overlay.speaker}`}
                  title={`Shape: ${overlay.maskShape ?? 'none'}`}
                >
                  {overlay.avatarName ?? overlay.speaker}
                </button>
                {shapePickerSpeaker === overlay.speaker && (
                  <div className={styles.shapeOptions} role="listbox" aria-label="Mask shapes">
                    {AVATAR_MASK_SHAPES.map((shape) => (
                      <button
                        key={shape}
                        className={`${styles.shapeOption} ${(overlay.maskShape ?? 'none') === shape ? styles.shapeOptionActive : ''}`}
                        onClick={() => {
                          onMaskShapeChange(overlay.speaker, shape);
                          setShapePickerSpeaker(null);
                        }}
                        type="button"
                        role="option"
                        aria-selected={(overlay.maskShape ?? 'none') === shape}
                        aria-label={shape}
                      >
                        <span className={`${styles.shapePreview} ${styles[`preview_${shape}`]}`} />
                        <span className={styles.shapeLabel}>{shape}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
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
