import styles from './FollowerCount.module.css';

interface FollowerCountProps {
  count: number;
  label: 'followers' | 'following' | 'podcasts';
  onClick?: () => void;
}

function formatCount(count: number): string {
  if (count >= 1_000_000) {
    const value = count / 1_000_000;
    return value % 1 === 0 ? `${value}M` : `${value.toFixed(1)}M`;
  }
  if (count >= 1_000) {
    const value = count / 1_000;
    return value % 1 === 0 ? `${value}k` : `${value.toFixed(1)}k`;
  }
  return count.toString();
}

export function FollowerCount({ count, label, onClick }: FollowerCountProps) {
  const isClickable = Boolean(onClick);
  const Tag = isClickable ? 'button' : 'div';

  return (
    <Tag
      className={`${styles.root} ${isClickable ? styles.clickable : ''}`}
      onClick={onClick}
      {...(isClickable
        ? {
            type: 'button' as const,
            'aria-label': `${formatCount(count)} ${label}`,
          }
        : {})}
    >
      <span className={styles.count}>{formatCount(count)}</span>
      <span className={styles.label}>{label}</span>
    </Tag>
  );
}
