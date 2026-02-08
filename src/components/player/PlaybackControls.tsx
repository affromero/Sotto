'use client';

import { usePlayer } from '@/components/providers/AudioPlayerProvider';
import styles from './PlaybackControls.module.css';

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function PlaybackControls() {
  const player = usePlayer();

  const cyclePlaybackRate = () => {
    if (!player) return;
    const currentIndex = PLAYBACK_RATES.indexOf(player.playbackRate);
    const nextIndex = (currentIndex + 1) % PLAYBACK_RATES.length;
    player.setPlaybackRate(PLAYBACK_RATES[nextIndex]);
  };

  if (!player) return null;

  return (
    <div className={styles.controls}>
      <button
        className={styles.secondaryButton}
        onClick={() => player.skip(-15)}
        aria-label="Skip back 15 seconds"
        title="Back 15s"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 4v6h6" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          <text x="12" y="16" textAnchor="middle" fill="currentColor" stroke="none" fontSize="8" fontWeight="bold">15</text>
        </svg>
      </button>

      <button
        className={styles.playButton}
        onClick={player.toggle}
        aria-label={player.isPlaying ? 'Pause' : 'Play'}
      >
        {player.isPlaying ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6,4 20,12 6,20" />
          </svg>
        )}
      </button>

      <button
        className={styles.secondaryButton}
        onClick={() => player.skip(15)}
        aria-label="Skip forward 15 seconds"
        title="Forward 15s"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 4v6h-6" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          <text x="12" y="16" textAnchor="middle" fill="currentColor" stroke="none" fontSize="8" fontWeight="bold">15</text>
        </svg>
      </button>

      <button
        className={styles.rateButton}
        onClick={cyclePlaybackRate}
        aria-label={`Playback speed ${player.playbackRate}x`}
      >
        {player.playbackRate}x
      </button>

      <div className={styles.volumeGroup}>
        <button
          className={styles.secondaryButton}
          onClick={player.toggleMute}
          aria-label={player.isMuted ? 'Unmute' : 'Mute'}
        >
          {player.isMuted || player.volume === 0 ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
        </button>
        <input
          type="range"
          className={styles.volumeSlider}
          min="0"
          max="1"
          step="0.05"
          value={player.isMuted ? 0 : player.volume}
          onChange={(e) => player.setVolume(parseFloat(e.target.value))}
          aria-label="Volume"
        />
      </div>
    </div>
  );
}
