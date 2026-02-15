import styles from './Footer.module.css';

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span className={styles.logo}>Sotto</span>
          <p>Podcasts that listen back.</p>
        </div>
        <div className={styles.links}>
          <div>
            <h4>Product</h4>
            <a href="/feed">Feed</a>
            <a href="/create">Create</a>
          </div>
          <div>
            <h4>Company</h4>
            <a href="/feedback">Feedback</a>
            <a href="/support">Support</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </div>
        </div>
      </div>
      <div className={styles.copyright}>
        © {new Date().getFullYear()} Sotto. All rights reserved.
      </div>
    </footer>
  );
}
