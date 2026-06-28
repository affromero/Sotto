import type { Metadata } from 'next';
import Link from 'next/link';
import { DownloadOptions } from './DownloadOptions';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Download Sotto',
  description:
    'Get Sotto on your computer, phone, or server. The desktop app runs the whole stack for you; the mobile app and PWA connect to your server.',
};

export default function DownloadPage() {
  return (
    <main className={styles.main}>
      <nav className={styles.topNav} aria-label="Download page">
        <Link href="/" className={styles.homeLink}>
          Back to home
        </Link>
      </nav>

      <header className={styles.hero}>
        <h1 className={styles.title}>Get Sotto</h1>
        <p className={styles.subtitle}>
          Run it on your own computer in one click, reach it from your phone, or host it on a server
          for the whole household. Your courses, audio, and data stay where you put them.
        </p>
      </header>

      <DownloadOptions />

      <section className={styles.serverBlock} aria-labelledby="server-heading">
        <h2 id="server-heading" className={styles.sectionTitle}>
          Host it on a server
        </h2>
        <p className={styles.sectionText}>
          For a VPS or home server, one command pulls the prebuilt images and starts everything. no
          clone, no build:
        </p>
        <pre className={styles.command}>
          <code>curl -fsSL https://sotto.fm/install.sh | bash</code>
        </pre>
        <p className={styles.sectionText}>
          Then open it from any device, or pair a phone/tablet from{' '}
          <strong>Settings → Devices</strong>. Storage is yours: keep audio and data on the local
          disk, or point Sotto at S3/R2.
        </p>
      </section>
    </main>
  );
}
