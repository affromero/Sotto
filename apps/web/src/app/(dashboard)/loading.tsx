import styles from './loading.module.css';

export default function DashboardLoading() {
  return (
    <div className={styles.root} role="status" aria-label="Loading dashboard">
      {/* Header row */}
      <div className={styles.headerRow}>
        <div className={`${styles.bone} ${styles.greeting}`} aria-hidden="true" />
        <div className={`${styles.bone} ${styles.cta} ${styles.delay1}`} aria-hidden="true" />
      </div>

      {/* Stats row */}
      <div className={styles.statsRow}>
        <div className={`${styles.bone} ${styles.statCard}`} aria-hidden="true" />
        <div className={`${styles.bone} ${styles.statCard} ${styles.delay1}`} aria-hidden="true" />
        <div className={`${styles.bone} ${styles.statCard} ${styles.delay2}`} aria-hidden="true" />
      </div>

      {/* My Episodes section */}
      <div className={`${styles.bone} ${styles.sectionTitle} ${styles.delay2}`} aria-hidden="true" />
      <div className={styles.cardGrid}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={styles.card} aria-hidden="true">
            <div className={`${styles.bone} ${styles.cardCover}`} style={{ animationDelay: `${100 + i * 100}ms` }} />
            <div className={`${styles.bone} ${styles.cardLine}`} style={{ animationDelay: `${200 + i * 100}ms` }} />
            <div className={`${styles.bone} ${styles.cardLineShort}`} style={{ animationDelay: `${300 + i * 100}ms` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
