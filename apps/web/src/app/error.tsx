'use client';

import Link from 'next/link';
import styles from './error.module.css';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className={styles.root}>
      <div className={styles.icon} aria-hidden="true">
        &#x26A0;&#xFE0F;
      </div>
      <h1 className={styles.title}>Something went wrong</h1>
      <p className={styles.description}>
        An unexpected error occurred. You can try again or head back to the feed.
      </p>
      <div className={styles.actions}>
        <button className={styles.retry} onClick={reset}>
          Try Again
        </button>
        <Link href="/feed" className={styles.back}>
          Back to Feed
        </Link>
      </div>
    </main>
  );
}
