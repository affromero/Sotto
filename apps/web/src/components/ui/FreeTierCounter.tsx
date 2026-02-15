'use client';

import styles from './FreeTierCounter.module.css';

interface FreeTierCounterProps {
  used: number;
  limit: number;
}

export function FreeTierCounter({ used, limit }: FreeTierCounterProps) {
  const remaining = Math.max(0, limit - used);
  const variant = remaining === 0 ? 'exhausted' : remaining <= 1 ? 'warning' : 'default';

  return (
    <span className={`${styles.pill} ${styles[variant]}`} aria-label={`${used} of ${limit} free generations used`}>
      {used}/{limit} free
    </span>
  );
}
