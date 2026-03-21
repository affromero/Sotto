'use client';

import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { Maximize2, Minimize2, Minus, Plus, Subtitles, Play as PlayIcon, Pause, RotateCcw, RotateCw } from 'lucide-react';
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
  const { isPlaying, play, pause, skip } = usePlayer();
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [expanded, setExpanded] = useState(false);
  const [shapePickerSpeaker, setShapePickerSpeaker] = useState<string | null>(null);
  const [subtitleScale, setSubtitleScale] = useState(0.8);
  const [subtitlesVisible, setSubtitlesVisible] = useState(true);
  const [skipRipple, setSkipRipple] = useState<'left' | 'right' | null>(null);
  const lastTapRef = useRef<{ time: number; side: 'left' | 'right' } | null>(null);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SUBTITLE_MIN = 0.6;
  const SUBTITLE_MAX = 1.8;
  const SUBTITLE_STEP = 0.2;
  const SKIP_SECONDS = 15;

  // Single tap = play/pause, double-tap = skip ±15s (YouTube-style)
  const handleVideoAreaClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, [role="button"], a, [role="tooltip"]')) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const side = x < rect.width / 2 ? 'left' : 'right';
    const now = Date.now();
    const lastTap = lastTapRef.current;

    if (lastTap && lastTap.side === side && now - lastTap.time < 400) {
      // Double-tap — skip
      if (singleTapTimer.current) { clearTimeout(singleTapTimer.current); singleTapTimer.current = null; }
      skip(side === 'right' ? SKIP_SECONDS : -SKIP_SECONDS);
      setSkipRipple(side);
      setTimeout(() => setSkipRipple(null), 600);
      lastTapRef.current = null;
    } else {
      // First tap — wait to see if it becomes a double-tap
      lastTapRef.current = { time: now, side };
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      singleTapTimer.current = setTimeout(() => {
        // Single tap confirmed — toggle play/pause
        if (isPlaying) pause(); else play();
        singleTapTimer.current = null;
      }, 400);
    }
  }, [skip, isPlaying, play, pause]);

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

  // Avatar should appear when the voice becomes audible during the crossfade,
  // not at startTime. The audio stitcher uses 300ms crossfades, so the voice
  // starts ~300ms before the segment's startTime in the stitched audio.
  const CROSSFADE_SEC = 0.3;
  const avatarIndex = findActiveIndex(segments, currentTime + CROSSFADE_SEC);
  const avatarSegment = segments[avatarIndex] ?? activeSegment;

  // Show avatar only when the matching speaker is active AND the segment is enabled
  const visibleOverlays = useMemo(() => {
    if (!avatarSegment) return [];
    return playableOverlays.filter((o) => {
      if (o.speaker !== avatarSegment.speaker) return false;
      // If enabledSegmentIds is set, only show on those segments
      const enabled = o.enabledSegmentIds;
      if (enabled && enabled.length > 0) return enabled.includes(avatarSegment.id);
      return true;
    });
  }, [playableOverlays, avatarSegment]);

  // Compute avatar video time: cumulative duration of prior enabled same-speaker segments + elapsed in current
  const avatarTimeMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!avatarSegment) return map;
    for (const overlay of playableOverlays) {
      const enabled = overlay.enabledSegmentIds;
      const isEnabled = (segId: string) => !enabled || enabled.length === 0 || enabled.includes(segId);
      let avatarTime = 0;
      for (let i = 0; i < segments.length; i++) {
        if (segments[i].speaker !== overlay.speaker) continue;
        if (!isEnabled(segments[i].id)) continue;
        if (i < avatarIndex) {
          avatarTime += segments[i].duration ?? 0;
        } else if (i === avatarIndex) {
          avatarTime += Math.max(0, currentTime - (segments[i].startTime ?? 0));
          break;
        }
      }
      map.set(overlay.speaker, avatarTime);
    }
    return map;
  }, [playableOverlays, segments, avatarIndex, avatarSegment, currentTime]);
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

  const handleSubtitleClick = useCallback((e: React.MouseEvent) => {
    // Don't seek when clicking a citation marker
    if ((e.target as HTMLElement).closest('button, [role="tooltip"], a')) return;
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
    <div className={`${styles.root} ${expanded ? styles.expanded : ''}`} aria-label="Video view">
      <div className={styles.videoContainer} ref={containerRef} onClick={handleVideoAreaClick}>
        <button
          className={styles.expandToggle}
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? 'Collapse video' : 'Expand video'}
          title={expanded ? 'Collapse' : 'Expand'}
          type="button"
        >
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
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
            videoUrl={overlay.status !== 'failed' ? (overlay.videoUrl ?? overlay.chunkVideoUrl!) : ''}
            maxDuration={overlay.videoUrl ? undefined : (overlay.chunkDurationSeconds ?? undefined)}
            streaming={!overlay.videoUrl && !!overlay.chunkVideoUrl}
            failed={overlay.status === 'failed'}
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
        {/* Play/Pause + Skip overlay */}
        <div className={`${styles.videoControls} ${isPlaying ? styles.videoControlsHidden : ''}`}>
          <button
            className={styles.skipBtn}
            onClick={() => skip(-SKIP_SECONDS)}
            aria-label="Rewind 15 seconds"
            title="Rewind 15s"
            type="button"
          >
            <RotateCcw size={20} />
          </button>
          <button
            className={styles.playToggle}
            onClick={() => (isPlaying ? pause() : play())}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            type="button"
          >
            {isPlaying ? <Pause size={32} /> : <PlayIcon size={32} />}
          </button>
          <button
            className={styles.skipBtn}
            onClick={() => skip(SKIP_SECONDS)}
            aria-label="Forward 15 seconds"
            title="Forward 15s"
            type="button"
          >
            <RotateCw size={20} />
          </button>
        </div>
        {/* Double-tap ripple feedback */}
        {skipRipple && (
          <div className={`${styles.skipRipple} ${styles[`skipRipple_${skipRipple}`]}`}>
            <span>{skipRipple === 'left' ? '−15s' : '+15s'}</span>
          </div>
        )}
        {/* Subtitle controls */}
        <div className={styles.subtitleControls}>
          <button
            className={`${styles.subtitleBtn} ${!subtitlesVisible ? styles.subtitleBtnOff : ''}`}
            onClick={() => setSubtitlesVisible((v) => !v)}
            aria-label={subtitlesVisible ? 'Hide subtitles' : 'Show subtitles'}
            title={subtitlesVisible ? 'Hide subtitles' : 'Show subtitles'}
            type="button"
          >
            <Subtitles size={14} />
          </button>
          {subtitlesVisible && (
            <>
              <button
                className={styles.subtitleBtn}
                onClick={() => setSubtitleScale((s) => Math.max(SUBTITLE_MIN, s - SUBTITLE_STEP))}
                disabled={subtitleScale <= SUBTITLE_MIN}
                aria-label="Smaller subtitles"
                title="Smaller subtitles"
                type="button"
              >
                <Minus size={12} />
              </button>
              <button
                className={styles.subtitleBtn}
                onClick={() => setSubtitleScale((s) => Math.min(SUBTITLE_MAX, s + SUBTITLE_STEP))}
                disabled={subtitleScale >= SUBTITLE_MAX}
                aria-label="Larger subtitles"
                title="Larger subtitles"
                type="button"
              >
                <Plus size={12} />
              </button>
            </>
          )}
        </div>
        {/* Subtitle overlay */}
        {subtitlesVisible && activeSegment && (
          <div className={styles.subtitleOverlay} style={{ '--subtitle-scale': subtitleScale } as React.CSSProperties}>
            <div
              className={styles.subtitleBlock}
              data-speaker-index={getSpeakerIndex(activeSegment.speaker, speakers)}
              onClick={handleSubtitleClick}
              role="button"
              tabIndex={0}
              onKeyDown={handleSubtitleKeyDown}
            >
              <span
                className={styles.speakerTag}
                data-speaker-index={getSpeakerIndex(activeSegment.speaker, speakers)}
              >
                {activeSegment.speaker}
              </span>
              <p className={styles.subtitleText}>
                {parseTextWithCitations(activeSegment.text, references)}
              </p>
            </div>
            {photographer && (
              <p className={styles.attribution}>
                {photographer} / Pexels
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
