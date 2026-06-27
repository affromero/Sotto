import { useId } from 'react';
import styles from './SottoSpinner.module.css';

interface SottoSpinnerProps {
  size?: 'small' | 'medium' | 'large';
  color?: 'primary' | 'accent' | 'white';
  progress?: number | null;
  label?: string;
  detail?: string;
  showPercent?: boolean;
  orientation?: 'inline' | 'stack';
  ariaLabel?: string;
  className?: string;
}

function normalizeProgress(progress: number | null | undefined): number | null {
  if (typeof progress !== 'number' || Number.isNaN(progress)) return null;
  return Math.min(Math.max(progress, 0), 1);
}

export function SottoSpinner({
  size = 'medium',
  color = 'primary',
  progress,
  label,
  detail,
  showPercent = false,
  orientation = 'inline',
  ariaLabel,
  className,
}: SottoSpinnerProps) {
  const gradientId = useId();
  const normalizedProgress = normalizeProgress(progress);
  const percent = normalizedProgress === null ? null : Math.round(normalizedProgress * 100);
  const hasCopy = Boolean(label || detail || (showPercent && percent !== null));
  const statusLabel =
    ariaLabel ?? label ?? (percent === null ? 'Loading' : `Loading, ${percent} percent complete`);

  return (
    <span
      role="status"
      aria-label={statusLabel}
      className={`${styles.root} ${styles[size]} ${styles[color]} ${hasCopy ? styles.withCopy : ''} ${
        hasCopy && orientation === 'stack' ? styles.stacked : ''
      } ${className ?? ''}`}
    >
      <span
        className={`${styles.mark} ${percent === null ? styles.indeterminate : styles.determinate}`}
        {...(percent === null
          ? { 'aria-hidden': true }
          : {
              role: 'progressbar',
              'aria-label': ariaLabel ?? label ?? 'Loading progress',
              'aria-valuemin': 0,
              'aria-valuemax': 100,
              'aria-valuenow': percent,
            })}
      >
        <svg className={styles.ring} viewBox="0 0 100 100" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="16" y1="8" x2="84" y2="92">
              <stop offset="0" stopColor="#6AA0FF" />
              <stop offset="0.54" stopColor="#8B7BFF" />
              <stop offset="1" stopColor="#FF8FB1" />
            </linearGradient>
          </defs>
          <circle className={styles.track} cx="50" cy="50" r="43" strokeWidth="7" />
          <circle
            className={styles.meter}
            cx="50"
            cy="50"
            r="43"
            pathLength="100"
            stroke={`url(#${gradientId})`}
            strokeWidth="7"
            strokeDasharray={percent === null ? '34 66' : '100'}
            strokeDashoffset={percent === null ? '0' : 100 - percent}
            transform="rotate(-90 50 50)"
          />
        </svg>
        <span className={styles.logo} aria-hidden="true" />
      </span>

      {hasCopy && (
        <span className={styles.copy}>
          {label && <span className={styles.label}>{label}</span>}
          {detail && <span className={styles.detail}>{detail}</span>}
          {showPercent && percent !== null && <span className={styles.percent}>{percent}%</span>}
        </span>
      )}
    </span>
  );
}
