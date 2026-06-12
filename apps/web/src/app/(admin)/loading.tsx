import styles from './loading.module.css';

export default function AdminLoading() {
  return (
    <div className={styles.root} role="status" aria-label="Loading admin">
      {/* Header */}
      <div className={`${styles.bone} ${styles.header}`} aria-hidden="true" />

      {/* Stat cards */}
      <div className={styles.statsGrid}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`${styles.bone} ${styles.statCard}`}
            style={{ animationDelay: `${i * 100}ms` }}
            aria-hidden="true"
          />
        ))}
      </div>

      {/* Table placeholder */}
      <div className={styles.table}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`${styles.bone} ${styles.tableRow}`}
            style={{ animationDelay: `${100 + i * 100}ms`, width: `${90 - i * 10}%` }}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}
