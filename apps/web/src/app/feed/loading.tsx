import styles from './loading.module.css';

export default function FeedLoading() {
  return (
    <div className={styles.root} role="status" aria-label="Loading feed">
      {/* Tag filter pills */}
      <div className={styles.pillsRow}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`${styles.bone} ${styles.pill}`}
            style={{ animationDelay: `${i * 50}ms`, width: `${50 + i * 8}px` }}
            aria-hidden="true"
          />
        ))}
      </div>

      {/* Feed grid */}
      <div className={styles.cardGrid}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={styles.card} aria-hidden="true">
            <div className={`${styles.bone} ${styles.cardCover}`} style={{ animationDelay: `${100 + i * 100}ms` }} />
            <div className={styles.cardMeta}>
              <div className={`${styles.bone} ${styles.avatar}`} style={{ animationDelay: `${200 + i * 100}ms` }} />
              <div className={`${styles.bone} ${styles.statBar}`} style={{ animationDelay: `${300 + i * 100}ms` }} />
            </div>
            <div className={`${styles.bone} ${styles.statBarShort}`} style={{ animationDelay: `${400 + i * 100}ms` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
