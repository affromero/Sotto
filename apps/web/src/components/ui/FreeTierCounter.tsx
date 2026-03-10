'use client';

import styles from './FreeTierCounter.module.css';

interface FreeTierCounterProps {
  dailyUsed: number;
  dailyLimit: number;
  isByokUser: boolean;
  isProUser: boolean;
}

export function FreeTierCounter({
  dailyUsed,
  dailyLimit,
  isByokUser,
  isProUser,
}: FreeTierCounterProps) {
  if (isByokUser) return null;

  if (isProUser) {
    const remaining = Math.max(0, dailyLimit - dailyUsed);
    const variant = remaining === 0 ? 'exhausted' : remaining <= 1 ? 'warning' : 'pro';
    return (
      <span
        className={`${styles.pill} ${styles[variant]}`}
        aria-label={`Pro: ${dailyUsed} of ${dailyLimit} podcasts used today`}
      >
        Pro {dailyUsed}/{dailyLimit}
      </span>
    );
  }

  // dailyLimit === 0 is the sentinel for unlimited (admin dailyGenerationOverride = 0)
  if (dailyLimit === 0) {
    return (
      <span className={`${styles.pill} ${styles.pro}`} aria-label="Unlimited generation">
        Unlimited
      </span>
    );
  }

  const remaining = Math.max(0, dailyLimit - dailyUsed);
  const variant = remaining === 0 ? 'exhausted' : remaining <= 1 ? 'warning' : 'default';

  return (
    <span
      className={`${styles.pill} ${styles[variant]}`}
      aria-label={`${dailyUsed} of ${dailyLimit} free podcasts used today`}
    >
      {dailyUsed}/{dailyLimit} today
    </span>
  );
}
