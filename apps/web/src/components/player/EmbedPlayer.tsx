'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './EmbedPlayer.module.css';

interface EmbedPlayerProps {
  podcastId: string;
  title: string;
  creatorName: string;
  audioUrl: string;
  duration: number | null;
  appBaseUrl: string;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function EmbedPlayer({
  podcastId,
  title,
  creatorName,
  audioUrl,
  duration,
  appBaseUrl,
}: EmbedPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration || 0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setTotalDuration(audio.duration);
      }
    };
    const onEnded = () => setPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
    setPlaying(!playing);
  }, [playing]);

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || !totalDuration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      audio.currentTime = pct * totalDuration;
    },
    [totalDuration]
  );

  const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  return (
    <div className={styles.player}>
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      <div className={styles.content}>
        <button
          className={styles.playBtn}
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          type="button"
        >
          {playing ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <div className={styles.info}>
          <span className={styles.title}>{title}</span>
          <span className={styles.creator}>{creatorName}</span>
        </div>

        <span className={styles.duration}>
          {formatTime(currentTime)} / {formatTime(totalDuration)}
        </span>
      </div>

      <div className={styles.progressWrap}>
        <div
          className={styles.progressBar}
          onClick={handleProgressClick}
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Playback progress"
        >
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className={styles.footer}>
        <a
          href={`${appBaseUrl}/podcast/${podcastId}?utm_source=embed&utm_medium=player&utm_campaign=listen`}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.poweredBy}
        >
          Powered by Sotto
        </a>
      </div>
    </div>
  );
}
