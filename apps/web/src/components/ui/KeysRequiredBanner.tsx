'use client';

import { useState, useSyncExternalStore, useCallback } from 'react';
import Link from 'next/link';
import styles from './KeysRequiredBanner.module.css';

const DISMISS_KEY = 'sotto:keys-banner-dismissed';

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

export function KeysRequiredBanner() {
  const wasPreviouslyDismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [dismissedNow, setDismissedNow] = useState(false);
  const dismissed = wasPreviouslyDismissed || dismissedNow;

  const handleDismiss = useCallback(() => {
    setDismissedNow(true);
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
  }, []);

  if (dismissed) {
    return null;
  }

  return (
    <div className={styles.banner} role="status" aria-label="API keys required">
      <svg
        className={styles.icon}
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
      </svg>
      <div className={styles.content}>
        <div>
          <p className={styles.title}>Connect your API keys to start creating podcasts</p>
          <p className={styles.description}>
            Sotto requires your own AI and TTS provider keys (BYOK) to generate podcasts.
          </p>
        </div>
        <Link href="/onboarding?step=keys" className={styles.link}>
          Set up keys
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
    </div>
  );
}
