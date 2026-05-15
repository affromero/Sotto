'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import Link from 'next/link';
import styles from './error.module.css';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className={styles.root}>
      <div className={styles.icon} aria-hidden="true">
        &#x26A0;&#xFE0F;
      </div>
      <h1 className={styles.title}>Something went wrong</h1>
      <p className={styles.description}>
        An unexpected error occurred. You can try again or head home.
      </p>
      <div className={styles.actions}>
        <button className={styles.retry} onClick={reset}>
          Try Again
        </button>
        <Link href="/" className={styles.back}>
          Go Home
        </Link>
      </div>
    </main>
  );
}
