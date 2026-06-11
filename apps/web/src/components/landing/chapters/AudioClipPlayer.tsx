'use client';

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { PodcastVisuals, DEFAULT_RENDER_CONFIG, DEFAULT_BRANDING } from '@sotto/video';
import type { VisualsInput } from '@sotto/video';
import { buildVideoSegments, computeTotalFrames } from '@/lib/segment-utils';
import type { SegmentVisualData } from '@/lib/segment-utils';
import type { SegmentData } from '@/types/podcast';
import { useShowcaseToggles } from '../ShowcaseTogglesProvider';
import styles from './AudioClipPlayer.module.css';

interface VideoClip {
  url: string;
  start: number;
  end: number;
}

interface ClipSegment {
  id: string;
  order: number;
  speaker: string;
  text: string;
  startTime: number;
  duration: number;
  wordTimings?: Array<{ word: string; start: number; end: number }> | null;
}

interface ClipVisual {
  id: string;
  segmentId: string;
  order: number;
  subOrder: number;
  startOffset: number;
  subDuration: number | null;
  visualType: string;
  visualMode: string | null;
  prompt: string | null;
  metadata: Record<string, unknown> | null;
  assetUrl: string | null;
  assetType: string | null;
  firstFrameUrl: string | null;
  status: string;
}

interface AudioClipPlayerProps {
  title: string;
  voiceCount: number;
  sourceCount: number;
  audioUrl: string;
  startTime: number;
  endTime: number;
  totalDuration: number;
  podcastId: string;
  videoClip?: VideoClip | null;
  clipSegments?: ClipSegment[];
  clipVisuals?: ClipVisual[];
  showVideoToggle?: boolean;
}

const FPS = DEFAULT_RENDER_CONFIG.fps;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDurationMinutes(seconds: number): string {
  if (!seconds) return '';
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

export function AudioClipPlayer({
  title,
  voiceCount,
  sourceCount,
  audioUrl,
  startTime,
  endTime,
  totalDuration,
  podcastId,
  videoClip,
  clipSegments = [],
  clipVisuals = [],
  showVideoToggle = false,
}: AudioClipPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const remotionRef = useRef<PlayerRef>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [localVideoEnabled, setLocalVideoEnabled] = useState(false);

  // When inside ShowcaseTogglesProvider (landing page), read from context.
  // When outside (admin dashboard), fall back to local state.
  const showcaseToggles = useShowcaseToggles();
  const videoEnabled = showcaseToggles ? showcaseToggles.videoEnabled : localVideoEnabled;
  const avatarEnabled = showcaseToggles?.avatarEnabled ?? false;

  // Prefer composed MP4, fall back to client-side Remotion Player
  const hasRemotionVisuals = clipSegments.length > 0 && clipVisuals.length > 0;
  const showMp4Video = videoClip && videoEnabled;
  const showRemotionVideo = !videoClip && hasRemotionVisuals && videoEnabled;
  const showVideo = showMp4Video || showRemotionVideo;
  const showLocalVideoToggle = !showcaseToggles && showVideoToggle && (videoClip || hasRemotionVisuals);


  // Build Remotion Player input from clip segments/visuals
  const segmentData = useMemo<SegmentData[]>(() =>
    clipSegments.map((s) => ({ ...s, startTime: s.startTime, duration: s.duration, audioUrl: null })) as SegmentData[],
    [clipSegments],
  );
  const visualData = useMemo<SegmentVisualData[]>(() =>
    clipVisuals.map((v) => ({ ...v, videoModel: null, failureReason: null })),
    [clipVisuals],
  );
  const videoSegments = useMemo(() => buildVideoSegments(segmentData, visualData), [segmentData, visualData]);
  const totalFrames = useMemo(() => computeTotalFrames(videoSegments, FPS), [videoSegments]);
  const remotionInput = useMemo<VisualsInput>(() => ({
    segments: videoSegments,
    config: DEFAULT_RENDER_CONFIG,
    branding: DEFAULT_BRANDING,
  }), [videoSegments]);

  const clipDuration = endTime - startTime;
  const progress = clipDuration > 0 ? Math.min(currentTime / clipDuration, 1) : 0;



  const syncVideo = useCallback((time: number, playing: boolean) => {
    // Sync MP4 <video> element
    const video = videoRef.current;
    if (video) {
      if (Math.abs(video.currentTime - time) > 0.3) {
        video.currentTime = time;
      }
      if (playing && video.paused) {
        video.play().catch(() => {});
      } else if (!playing && !video.paused) {
        video.pause();
      }
    }
    // Sync Remotion Player
    const player = remotionRef.current;
    if (player) {
      const elapsed = time - startTime;
      const frame = Math.round(Math.max(0, elapsed) * FPS);
      player.seekTo(frame);
      if (playing) player.play(); else player.pause();
    }
  }, [startTime]);

  const handlePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      syncVideo(audio.currentTime, false);
      setIsPlaying(false);
    } else {
      // Only seek to start if we haven't started yet or finished
      if (audio.currentTime < startTime || audio.currentTime >= endTime) {
        audio.currentTime = startTime;
      }
      audio.play();
      syncVideo(audio.currentTime, true);
      setIsPlaying(true);
    }
  }, [isPlaying, startTime, endTime, syncVideo]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.load();
  }, [audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      const elapsed = audio.currentTime - startTime;
      setCurrentTime(Math.max(0, elapsed));
      syncVideo(audio.currentTime, true);

      if (audio.currentTime >= endTime) {
        audio.pause();
        audio.currentTime = startTime;
        syncVideo(startTime, false);
        setIsPlaying(false);
        setCurrentTime(0);
      }
    };

    const onEnded = () => {
      syncVideo(startTime, false);
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
    };
  }, [startTime, endTime, syncVideo]);

  return (
    <div className={styles.mockPlayer}>
      <div className={styles.mockHeader}>
        <div className={styles.mockDot} aria-hidden="true" />
        <span>Now Playing</span>
      </div>
      <div className={styles.mockBody}>
        {showVideo && (
          <div className={styles.videoInline}>
            {showMp4Video && videoClip ? (
              <>
                { }
                <video
                  ref={videoRef}
                  src={videoClip.url}
                  preload="metadata"
                  className={styles.videoPlayer}
                  playsInline
                  muted
                />
              </>
            ) : showRemotionVideo && totalFrames > 0 ? (
              <Player
                ref={remotionRef}
                component={PodcastVisuals as unknown as React.ComponentType<Record<string, unknown>>}
                inputProps={remotionInput as unknown as Record<string, unknown>}
                durationInFrames={totalFrames}
                fps={FPS}
                compositionWidth={DEFAULT_RENDER_CONFIG.width}
                compositionHeight={DEFAULT_RENDER_CONFIG.height}
                style={{ width: '100%', height: '100%' }}
                controls={false}
              />
            ) : null}
            {!isPlaying && (
              <button
                type="button"
                className={styles.videoPlayOverlay}
                onClick={handlePlay}
                aria-label="Play"
              >
                <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            )}
          </div>
        )}

        {avatarEnabled && (
          <div className={styles.avatarPlaceholder}>
            <div className={`${styles.avatarCircle} ${styles.avatarHost}`} aria-hidden="true">H</div>
            <div className={`${styles.avatarCircle} ${styles.avatarExpert}`} aria-hidden="true">E</div>
            <span className={styles.avatarLabel}>Avatar presenters</span>
          </div>
        )}

        <a href={`/podcast/${podcastId}`} className={styles.playerTitle}>
          {title}
        </a>
        <div className={styles.playerMeta}>
          {formatDurationMinutes(totalDuration)} &middot; {voiceCount} voices &middot; {sourceCount} sources
        </div>

        <div className={styles.playerPlayRow}>
          <button
            className={`${styles.playButton} ${isPlaying ? styles.playButtonActive : ''}`}
            onClick={handlePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <div className={styles.playerProgress}>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <div className={styles.playerWaveform}>
              {Array.from({ length: 32 }, (_, i) => (
                <span
                  key={i}
                  className={`${styles.playerBar} ${i / 32 <= progress ? styles.playerBarActive : ''}`}
                  style={{ '--i': i } as React.CSSProperties}
                />
              ))}
            </div>
          </div>
        </div>
        <div className={styles.playerControls}>
          <span className={styles.playerTime}>
            {formatTime(currentTime)} / {formatTime(clipDuration)}
          </span>
          <div className={styles.playerActions}>
            {showLocalVideoToggle && (
              <button
                type="button"
                className={`${styles.videoToggle} ${localVideoEnabled ? styles.videoToggleActive : ''}`}
                onClick={() => setLocalVideoEnabled((v) => !v)}
                aria-pressed={localVideoEnabled}
                aria-label={`Video: ${localVideoEnabled ? 'On' : 'Off'}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4V6.5l-4 4z" />
                </svg>
                Video
              </button>
            )}
            <a href={`/podcast/${podcastId}`} className={styles.playerAction}>
              Open
            </a>
          </div>
        </div>
      </div>
      { }
      <audio ref={audioRef} src={audioUrl} preload="metadata" />
    </div>
  );
}
