'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePlayer } from '@/components/providers/AudioPlayerProvider';
import { PlaybackControls } from './PlaybackControls';
import { ListeningQueue } from './ListeningQueue';
import styles from './AudioPlayer.module.css';

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

interface AudioPlayerProps {
  podcastId?: string;
  audioUrl?: string;
  podcastTitle?: string;
}

export function AudioPlayer({ podcastId: initialPodcastId, audioUrl, podcastTitle }: AudioPlayerProps) {
  const player = usePlayer();
  const progressRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<string | null>(null);

  useEffect(() => {
    if (initialPodcastId && audioUrl && loadedRef.current !== initialPodcastId) {
      loadedRef.current = initialPodcastId;
      player.loadPodcast(initialPodcastId, audioUrl, podcastTitle);
    }
  }, [initialPodcastId, audioUrl, podcastTitle]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!player || !progressRef.current) return;
      const rect = progressRef.current.getBoundingClientRect();
      const fraction = (e.clientX - rect.left) / rect.width;
      player.seek(fraction * player.duration);
    },
    [player]
  );

  const handlePlayFromQueue = useCallback(
    (podcastId: string, audioUrl: string, title?: string) => {
      player.loadPodcast(podcastId, audioUrl, title);
      player.play();
    },
    [player]
  );

  if (!player || !player.podcastId) return null;

  const progress = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0;

  return (
    <div className={styles.player}>
      <div className={styles.progressSection}>
        <span className={styles.time}>{formatTime(player.currentTime)}</span>
        <div
          className={styles.progressBar}
          ref={progressRef}
          onClick={handleProgressClick}
          role="slider"
          aria-label="Playback progress"
          aria-valuemin={0}
          aria-valuemax={player.duration}
          aria-valuenow={player.currentTime}
          tabIndex={0}
        >
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
            <div className={styles.progressThumb} style={{ left: `${progress}%` }} />
          </div>
        </div>
        <span className={styles.time}>{formatTime(player.duration)}</span>
      </div>

      <div className={styles.controlsRow}>
        <PlaybackControls />
        <ListeningQueue onPlayPodcast={handlePlayFromQueue} />
      </div>
    </div>
  );
}
