import type { PodcastCostBreakdown } from '@/lib/podcast-cost-stats';
import { OwnerOnlyBadge } from '@/components/ui/OwnerOnlyBadge';
import styles from './CostBreakdown.module.css';

interface CostBreakdownProps {
  breakdown: PodcastCostBreakdown;
}

const BUCKETS = [
  { key: 'text' as const, label: 'Text', icon: '🔤' },
  { key: 'audio' as const, label: 'Audio', icon: '🎙' },
  { key: 'video' as const, label: 'Video', icon: '🎬' },
  { key: 'avatar' as const, label: 'Avatar', icon: '👤' },
] as const;

function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

export function CostBreakdown({ breakdown }: CostBreakdownProps) {
  const activeBuckets = BUCKETS.filter((b) => breakdown[b.key] > 0);

  if (activeBuckets.length === 0) return null;

  return (
    <section className={styles.root} aria-label="Generation cost breakdown">
      <div className={styles.headerRow}>
        <h3 className={styles.header}>Generation cost</h3>
        <OwnerOnlyBadge />
      </div>
      <div className={styles.chips}>
        {activeBuckets.map((bucket) => (
          <div key={bucket.key} className={styles.chip}>
            <span className={styles.chipIcon} aria-hidden="true">{bucket.icon}</span>
            <span className={styles.chipLabel}>{bucket.label}</span>
            <span className={styles.chipValue}>{formatCost(breakdown[bucket.key])}</span>
          </div>
        ))}
      </div>
      <p className={styles.total}>
        Total: {formatCost(breakdown.total)}
        <span className={styles.callCount}> ({breakdown.callCount} API calls)</span>
      </p>
    </section>
  );
}
