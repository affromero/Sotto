'use client';

import styles from './FreeTierCounter.module.css';

interface ProviderQuota {
  provider: string;
  quota: number;
  used: number;
  remaining: number;
}

interface FreeTierCounterProps {
  used: number;
  limit: number;
  ttsQuotas?: ProviderQuota[];
}

export function FreeTierCounter({ used, limit, ttsQuotas }: FreeTierCounterProps) {
  const remaining = Math.max(0, limit - used);
  const variant = remaining === 0 ? 'exhausted' : remaining <= 1 ? 'warning' : 'default';

  const hasBreakdown = ttsQuotas && ttsQuotas.length > 0;
  const tooltip = hasBreakdown
    ? ttsQuotas.map((q) => `${q.provider}: ${q.remaining}/${q.quota}`).join('\n')
    : undefined;

  return (
    <span
      className={`${styles.pill} ${styles[variant]}`}
      aria-label={`${used} of ${limit} free generations used`}
      title={tooltip}
    >
      {used}/{limit} free
    </span>
  );
}
