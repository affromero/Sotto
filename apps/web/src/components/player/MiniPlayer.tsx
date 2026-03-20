'use client';

import { useCallback, useRef } from 'react';
import { usePlayer } from '@/components/providers/AudioPlayerProvider';
import { WaveformBars } from '@/components/ui/WaveformBars';
import styles from './MiniPlayer.module.css';

interface MiniPlayerProps {
  podcastTitle?: string;
  onExpand?: () => void;
  onClose?: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MiniPlayer({ podcastTitle, onExpand, onClose }: MiniPlayerProps) {
  const player = usePlayer();
  const seekBarRef = useRef<HTMLDivElement>(null);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!player || !seekBarRef.current) return;
    const rect = seekBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    player.seek(ratio * player.duration);
  }, [player]);

  if (!player || !player.podcastId) return null;

  const progress = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0;

  return (
    <div className={`${styles.miniPlayer} ${player.isPlaying ? styles.playing : ''}`}>
      <div
        ref={seekBarRef}
        className={styles.seekBar}
        onClick={handleSeek}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={player.duration}
        aria-valuenow={player.currentTime}
        tabIndex={0}
      >
        <div className={styles.seekTrack}>
          <div className={styles.seekFill} style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className={styles.content}>
        <button className={styles.artworkButton} onClick={onExpand} aria-label="Expand player">
          <div className={styles.artwork}>
            {player.isPlaying ? (
              <WaveformBars className={styles.artworkWaveform} />
            ) : (
              <span className={styles.artworkLetter}>
                {podcastTitle?.charAt(0).toUpperCase() || 'P'}
              </span>
            )}
          </div>
        </button>

        <button className={styles.info} onClick={onExpand}>
          <span className={styles.title}>{podcastTitle || 'Now Playing'}</span>
          <span className={styles.time}>
            {formatTime(player.currentTime)} / {formatTime(player.duration)}
          </span>
        </button>

        <button
          className={styles.playButton}
          onClick={player.toggle}
          aria-label={player.isPlaying ? 'Pause' : 'Play'}
        >
          {player.isPlaying ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6,4 20,12 6,20" />
            </svg>
          )}
        </button>

        {onClose && (
          <button className={styles.closeButton} onClick={onClose} aria-label="Close player">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
