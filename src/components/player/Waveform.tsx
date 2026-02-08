'use client';

import styles from './Waveform.module.css';

interface WaveformProps {
  bars: number[];
  currentProgress: number;
  isPlaying?: boolean;
}

export function Waveform({ bars, currentProgress, isPlaying = false }: WaveformProps) {
  const activeIndex = Math.floor(currentProgress * bars.length);

  return (
    <div className={`${styles.waveform} ${isPlaying ? styles.playing : ''}`} role="presentation">
      {bars.map((amplitude, index) => (
        <div
          key={index}
          className={`${styles.bar} ${index <= activeIndex ? styles.active : styles.upcoming}`}
          style={{ height: `${Math.max(amplitude * 100, 8)}%` }}
        />
      ))}
    </div>
  );
}
