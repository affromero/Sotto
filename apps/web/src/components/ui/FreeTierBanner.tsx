'use client';

import { useState, useSyncExternalStore, useCallback } from 'react';
import Link from 'next/link';
import styles from './FreeTierBanner.module.css';

const DISMISS_KEY = 'sotto:free-tier-banner-dismissed';

function getSnapshot(): boolean {
  return localStorage.getItem(DISMISS_KEY) !== null;
}

function getServerSnapshot(): boolean {
  return true; // hidden on SSR
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

interface FreeTierBannerProps {
  used: number;
  limit: number;
  isByokUser: boolean;
}

export function FreeTierBanner({ used, limit, isByokUser }: FreeTierBannerProps) {
  const wasPreviouslyDismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [dismissedNow, setDismissedNow] = useState(false);
  const dismissed = wasPreviouslyDismissed || dismissedNow;

  const handleDismiss = useCallback(() => {
    setDismissedNow(true);
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
  }, []);

  // BYOK users don't need this banner
  if (isByokUser) return null;
  if (dismissed) return null;

  const remaining = Math.max(0, limit - used);
  const exhausted = remaining === 0;
  const variant = exhausted ? 'exhausted' : remaining <= 1 ? 'warning' : 'info';

  return (
    <div
      className={`${styles.banner} ${styles[variant]}`}
      role="status"
      aria-label="Free tier status"
    >
      <div className={styles.content}>
        <div>
          <p className={styles.title}>
            {exhausted
              ? 'Free generations used'
              : `${remaining} free generation${remaining !== 1 ? 's' : ''} remaining`}
          </p>
          <p className={styles.description}>
            {exhausted
              ? 'Add a voice provider key to keep creating podcasts.'
              : 'Add a voice provider key for unlimited generation.'}
          </p>
        </div>
        <Link href="/onboarding?step=keys" className={styles.link}>
          Add voice key
          <svg
            className={styles.linkArrow}
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </Link>
      </div>
      {!exhausted && (
        <button
          type="button"
          className={styles.dismissButton}
          onClick={handleDismiss}
          aria-label="Dismiss banner"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}
