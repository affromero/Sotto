import styles from './TopBar.module.css';

export function TopBar() {
  return (
    <header className={styles.topBar}>
      <a href="/" className={styles.logo}>Sotto</a>
      <nav className={styles.nav}>
        <a href="/feed">Feed</a>
        <a href="/create">Create</a>
        <a href="/pricing">Pricing</a>
      </nav>
      <div className={styles.actions}>
        <a href="/auth/login" className={styles.signIn}>Sign In</a>
      </div>
    </header>
  );
}
