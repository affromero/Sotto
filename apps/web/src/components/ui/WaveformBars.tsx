'use client';

import styles from './WaveformBars.module.css';

interface WaveformBarsProps {
  className?: string;
}

export function WaveformBars({ className }: WaveformBarsProps) {
  return (
    <span
      className={`${styles.root} ${className ?? ''}`}
      aria-hidden="true"
    >
      <span className={`${styles.bar} ${styles.bar0}`} />
      <span className={`${styles.bar} ${styles.bar1}`} />
      <span className={`${styles.bar} ${styles.bar2}`} />
      <span className={`${styles.bar} ${styles.bar3}`} />
      <span className={`${styles.bar} ${styles.bar4}`} />
    </span>
  );
}
