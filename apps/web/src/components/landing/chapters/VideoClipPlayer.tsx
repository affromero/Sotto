'use client';

import { useRef, useState, useCallback } from 'react';
import styles from './VideoClipPlayer.module.css';

interface VideoClipPlayerProps {
  videoUrl: string;
  startTime: number;
  endTime: number;
}

export function VideoClipPlayer({ videoUrl, startTime, endTime }: VideoClipPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const handleToggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.currentTime = startTime;
      video.play();
      setIsPlaying(true);
    }
  }, [isPlaying, startTime]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.currentTime >= endTime) {
      video.pause();
      video.currentTime = startTime;
      setIsPlaying(false);
    }
  }, [startTime, endTime]);

  return (
    <div className={styles.videoWrapper}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        src={videoUrl}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setIsPlaying(false)}
        className={styles.video}
        playsInline
      />
      <button
        className={styles.playOverlay}
        onClick={handleToggle}
        aria-label={isPlaying ? 'Pause video' : 'Play video'}
      >
        {!isPlaying && (
          <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
    </div>
  );
}
