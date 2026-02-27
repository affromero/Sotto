import styles from './loading.module.css';

export default function PodcastLoading() {
  return (
    <div className={styles.root} role="status" aria-label="Loading podcast">
      {/* Back link */}
      <div className={`${styles.bone} ${styles.backLink}`} aria-hidden="true" />

      {/* Title block */}
      <div className={`${styles.bone} ${styles.title} ${styles.delay1}`} aria-hidden="true" />
      <div className={`${styles.bone} ${styles.subtitle} ${styles.delay2}`} aria-hidden="true" />

      {/* Creator row */}
      <div className={styles.creatorRow}>
        <div className={`${styles.bone} ${styles.creatorAvatar} ${styles.delay1}`} aria-hidden="true" />
        <div className={`${styles.bone} ${styles.creatorName} ${styles.delay2}`} aria-hidden="true" />
        <div className={`${styles.bone} ${styles.creatorDate} ${styles.delay3}`} aria-hidden="true" />
      </div>

      {/* Player section */}
      <div className={`${styles.bone} ${styles.player} ${styles.delay2}`} aria-hidden="true" />

      {/* Actions row */}
      <div className={styles.actionsRow}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`${styles.bone} ${styles.actionCircle}`}
            style={{ animationDelay: `${300 + i * 100}ms` }}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}
