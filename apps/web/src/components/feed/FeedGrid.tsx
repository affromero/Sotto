import styles from './FeedGrid.module.css';

interface FeedGridProps {
  children: React.ReactNode;
  loading?: boolean;
  emptyMessage?: string;
}

function SkeletonCard() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      <div className={styles.skeletonCover} />
      <div className={styles.skeletonBody}>
        <div className={styles.skeletonCreator}>
          <div className={styles.skeletonAvatar} />
          <div className={styles.skeletonName} />
        </div>
        <div className={styles.skeletonStats}>
          <div className={styles.skeletonStat} />
          <div className={styles.skeletonStat} />
          <div className={styles.skeletonStat} />
        </div>
      </div>
    </div>
  );
}

export function FeedGrid({ children, loading = false, emptyMessage = 'No podcasts found' }: FeedGridProps) {
  if (loading) {
    return (
      <div className={styles.grid} role="status" aria-label="Loading podcasts">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
        <span className={styles.srOnly}>Loading podcasts...</span>
      </div>
    );
  }

  const hasChildren = Array.isArray(children)
    ? children.filter(Boolean).length > 0
    : Boolean(children);

  if (!hasChildren) {
    return (
      <div className={styles.empty} role="status">
        <div className={styles.emptyIcon} aria-hidden="true">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
            <path d="M26 24L40 32L26 40V24Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </div>
        <p className={styles.emptyMessage}>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {children}
    </div>
  );
}
