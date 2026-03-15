'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import styles from './AudioClipPlayer.module.css';

interface VoiceTrackOption {
  name: string;
  provider: string;
  model: string;
  audioUrl: string;
}

interface AudioClipPlayerProps {
  title: string;
  voiceCount: number;
  sourceCount: number;
  audioUrl: string;
  originalTrackName: string;
  startTime: number;
  endTime: number;
  totalDuration: number;
  podcastId: string;
  voiceTracks?: VoiceTrackOption[];
}

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
  originalTrackName,
  startTime,
  endTime,
  totalDuration,
  podcastId,
  voiceTracks = [],
}: AudioClipPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingResumeRef = useRef<{ elapsed: number; play: boolean } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeTrackIndex, setActiveTrackIndex] = useState(-1); // -1 = original

  const activeUrl = activeTrackIndex >= 0 ? voiceTracks[activeTrackIndex].audioUrl : audioUrl;
  const clipDuration = endTime - startTime;
  const progress = clipDuration > 0 ? Math.min(currentTime / clipDuration, 1) : 0;

  const handlePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.currentTime = startTime;
      audio.play();
      setIsPlaying(true);
    }
  }, [isPlaying, startTime]);

  const handleTrackSwitch = useCallback((index: number) => {
    if (index === activeTrackIndex) return;
    const audio = audioRef.current;
    const elapsed = audio ? audio.currentTime - startTime : 0;
    if (audio) audio.pause();
    pendingResumeRef.current = { elapsed: Math.max(0, elapsed), play: isPlaying };
    setActiveTrackIndex(index);
  }, [isPlaying, startTime, activeTrackIndex]);

  // When src changes, load and resume from saved position
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onCanPlay = () => {
      const pending = pendingResumeRef.current;
      if (!pending) return;
      pendingResumeRef.current = null;
      audio.currentTime = startTime + pending.elapsed;
      if (pending.play) {
        audio.play();
        setIsPlaying(true);
      }
    };

    audio.addEventListener('canplay', onCanPlay, { once: true });
    audio.load();

    return () => {
      audio.removeEventListener('canplay', onCanPlay);
    };
  }, [activeUrl, startTime]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      const elapsed = audio.currentTime - startTime;
      setCurrentTime(Math.max(0, elapsed));

      if (audio.currentTime >= endTime) {
        audio.pause();
        audio.currentTime = startTime;
        setIsPlaying(false);
        setCurrentTime(0);
      }
    };

    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
    };
  }, [startTime, endTime]);

  return (
    <div className={styles.mockPlayer}>
      <div className={styles.mockHeader}>
        <div className={styles.mockDot} aria-hidden="true" />
        <span>Now Playing</span>
      </div>
      <div className={styles.mockBody}>
        <a href={`/podcast/${podcastId}`} className={styles.playerTitle}>
          {title}
        </a>
        <div className={styles.playerMeta}>
          {formatDurationMinutes(totalDuration)} &middot; {voiceCount} voices &middot; {sourceCount} sources
        </div>

        {voiceTracks.length > 0 && (
          <div className={styles.trackSwitcher}>
            <button
              type="button"
              className={`${styles.trackBtn} ${activeTrackIndex === -1 ? styles.trackBtnActive : ''}`}
              onClick={() => handleTrackSwitch(-1)}
            >
              {originalTrackName}
            </button>
            {voiceTracks.map((track, i) => (
              <button
                key={i}
                type="button"
                className={`${styles.trackBtn} ${activeTrackIndex === i ? styles.trackBtnActive : ''}`}
                onClick={() => handleTrackSwitch(i)}
                title={`${track.provider} / ${track.model}`}
              >
                {track.name}
              </button>
            ))}
          </div>
        )}

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
            <a href={`/podcast/${podcastId}?fork=1`} className={styles.playerAction}>
              Fork
            </a>
            <a href={`/podcast/${podcastId}`} className={styles.playerAction}>
              Share
            </a>
          </div>
        </div>
      </div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={activeUrl} preload="metadata" />
    </div>
  );
}
