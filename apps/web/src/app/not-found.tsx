import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './not-found.module.css';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className={styles.root}>
      <p className={styles.code}>404</p>
      <h1 className={styles.title}>Page not found</h1>
      <p className={styles.description}>
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link href="/feed" className={styles.cta}>
        Back to Feed
      </Link>
    </main>
  );
}
