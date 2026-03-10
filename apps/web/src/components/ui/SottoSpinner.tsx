'use client';

import styles from './SottoSpinner.module.css';

interface SottoSpinnerProps {
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

const SIZE_MAP = { small: 24, medium: 40, large: 64 } as const;

export function SottoSpinner({ size = 'medium', className }: SottoSpinnerProps) {
  const px = SIZE_MAP[size];

  return (
    <span
      role="status"
      aria-label="Loading"
      className={`${styles.root} ${className ?? ''}`}
      style={{ '--spinner-size': `${px}px` } as React.CSSProperties}
    >
      <svg
        className={styles.arc}
        viewBox="0 0 100 100"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="50"
          cy="50"
          r="30"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="47 140"
        />
      </svg>
      <span className={styles.dot} />
    </span>
  );
}
