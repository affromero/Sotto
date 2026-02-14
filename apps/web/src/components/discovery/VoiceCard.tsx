import { useState, useRef } from 'react';
import styles from './VoiceCard.module.css';

interface VoiceCardProps {
  voiceId: string;
  name: string;
  accent?: string;
  character?: string;
  isSelected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function VoiceCard({
  voiceId,
  name,
  accent,
  character,
  isSelected,
  disabled = false,
  onSelect,
}: VoiceCardProps) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function handlePlay(e: React.MouseEvent) {
    e.stopPropagation();

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlaying(false);
      return;
    }

    try {
      setPlaying(true);
      const response = await fetch('/api/voices/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceId,
          text: 'Welcome to Sotto. Let me tell you something fascinating today.',
        }),
      });

      if (!response.ok) {
        setPlaying(false);
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        setPlaying(false);
        audioRef.current = null;
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setPlaying(false);
        audioRef.current = null;
        URL.revokeObjectURL(url);
      };

      await audio.play();
    } catch {
      setPlaying(false);
    }
  }

  const cardClass = [
    styles.card,
    isSelected ? styles.cardSelected : '',
    disabled ? styles.cardDisabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cardClass}
      onClick={disabled ? undefined : onSelect}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect();
        }
      }}
      aria-pressed={isSelected}
      aria-disabled={disabled}
      aria-label={`Voice: ${name}`}
    >
      <div className={styles.avatar}>{name.charAt(0)}</div>
      <div className={styles.info}>
        <div className={styles.name}>{name}</div>
        <div className={styles.meta}>
          {accent && <span className={styles.accent}>{accent}</span>}
          {character && <span>{character}</span>}
        </div>
      </div>
      <button
        type="button"
        className={styles.playButton}
        onClick={handlePlay}
        disabled={playing}
        aria-label={`Preview ${name}`}
      >
        {playing ? (
          <span className={styles.spinnerSmall} />
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M4 2.5v11l9-5.5L4 2.5z" />
          </svg>
        )}
      </button>
    </div>
  );
}
