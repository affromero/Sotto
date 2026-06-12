'use client';

import { usePlayer } from '@/components/providers/AudioPlayerProvider';
import styles from './InterruptButton.module.css';

interface InterruptButtonProps {
  onInterrupt: () => void;
}

export function InterruptButton({ onInterrupt }: InterruptButtonProps) {
  const player = usePlayer();

  const handleClick = () => {
    if (player?.isPlaying) {
      player.pause();
    }
    onInterrupt();
  };

  const isActive = player?.isPlaying ?? false;

  return (
    <button
      className={`${styles.button} ${isActive ? styles.active : ''}`}
      onClick={handleClick}
      disabled={!player?.episodeId}
      aria-label="Ask a question"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span>Ask a Question</span>
    </button>
  );
}
