import styles from './loading.module.css';

export default function CreateLoading() {
  return (
    <div className={styles.root} role="status" aria-label="Loading create page">
      {/* Header */}
      <div className={styles.header}>
        <div className={`${styles.bone} ${styles.backButton}`} aria-hidden="true" />
        <div className={styles.titleBlock}>
          <div className={`${styles.bone} ${styles.title}`} aria-hidden="true" />
          <div className={`${styles.bone} ${styles.subtitle} ${styles.delay1}`} aria-hidden="true" />
        </div>
      </div>

      {/* Tab toggle */}
      <div className={styles.tabRow}>
        <div className={`${styles.bone} ${styles.tab} ${styles.delay1}`} aria-hidden="true" />
        <div className={`${styles.bone} ${styles.tab} ${styles.delay2}`} aria-hidden="true" />
      </div>

      {/* Chat area */}
      <div className={styles.chatArea}>
        <div className={`${styles.bone} ${styles.messageBone} ${styles.delay2}`} aria-hidden="true" />
        <div className={`${styles.bone} ${styles.messageBoneShort} ${styles.delay3}`} aria-hidden="true" />
      </div>

      {/* Input bar */}
      <div className={`${styles.bone} ${styles.inputBar} ${styles.delay4}`} aria-hidden="true" />
    </div>
  );
}
