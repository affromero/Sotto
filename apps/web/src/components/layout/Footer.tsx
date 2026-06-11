import { BRAND } from '@sotto/shared';
import styles from './Footer.module.css';

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span className={styles.logo}>{BRAND.name}</span>
          <p>{BRAND.tagline}</p>
        </div>
        <div className={styles.links}>
          <div>
            <h4>Product</h4>
            <a href="/languages">Languages</a>
            <a href="/developers">Developers</a>
            <a href="/changelog">Changelog</a>
            <a href="https://github.com/affromero/Sotto" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </div>
          <div>
            <h4>Community</h4>
            <a href="https://discord.gg/Dm4T42RXa" target="_blank" rel="noopener noreferrer">
              Discord
            </a>
            {BRAND.twitter && (
              <a href={BRAND.twitter} target="_blank" rel="noopener noreferrer">
                Twitter
              </a>
            )}
            <a href="/feedback">Feedback</a>
          </div>
          <div>
            <h4>Project</h4>
            <a href="/support">Support</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/about">About</a>
            <a href="/join">Contribute</a>
          </div>
        </div>
      </div>
      <div className={styles.copyright}>
        © {new Date().getFullYear()} Sotto. All rights reserved.
      </div>
    </footer>
  );
}
