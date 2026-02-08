'use client';

import { usePlayer } from '@/components/providers/AudioPlayerProvider';
import styles from './MiniPlayer.module.css';

interface MiniPlayerProps {
  podcastTitle?: string;
  onExpand?: () => void;
  onClose?: () => void;
}

export function MiniPlayer({ podcastTitle, onExpand, onClose }: MiniPlayerProps) {
  const player = usePlayer();

  if (!player || !player.podcastId) return null;

  const progress = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0;

  return (
    <div className={styles.miniPlayer}>
      <div className={styles.progressLine} style={{ width: `${progress}%` }} />

      <div className={styles.content}>
        <button className={styles.artworkButton} onClick={onExpand} aria-label="Expand player">
          <div className={styles.artwork}>
            <span className={styles.artworkLetter}>
              {podcastTitle?.charAt(0).toUpperCase() || 'P'}
            </span>
          </div>
        </button>

        <button className={styles.info} onClick={onExpand}>
          <span className={styles.title}>{podcastTitle || 'Now Playing'}</span>
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
