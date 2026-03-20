'use client';

import { useState, useSyncExternalStore, useCallback, useEffect } from 'react';
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

function formatReset(seconds: number): string {
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.ceil((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

interface FreeTierBannerProps {
  dailyUsed: number;
  dailyLimit: number;
  isByokUser: boolean;
  isProUser: boolean;
  resetInSeconds?: number;
  email?: string;
}

export function FreeTierBanner({
  dailyUsed,
  dailyLimit,
  isByokUser,
  isProUser,
  resetInSeconds,
  email,
}: FreeTierBannerProps) {
  const wasPreviouslyDismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [dismissedNow, setDismissedNow] = useState(false);
  const [countdown, setCountdown] = useState(resetInSeconds ?? 0);
  const [waitlistState, setWaitlistState] = useState<'idle' | 'loading' | 'success'>('idle');

  const handleJoinWaitlist = useCallback(async (source: string) => {
    if (!email) return;
    setWaitlistState('loading');
    try {
      await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source }),
      });
      setWaitlistState('success');
    } catch {
      setWaitlistState('success');
    }
  }, [email]);

  useEffect(() => {
    if (!resetInSeconds || resetInSeconds <= 0) return;
    // Local mutable variable avoids calling setState directly in the effect body;
    // state is only updated inside the interval callback.
    let remaining = resetInSeconds;
    const id = setInterval(() => {
      remaining = Math.max(0, remaining - 1);
      setCountdown(remaining);
    }, 1000);
    return () => clearInterval(id);
  }, [resetInSeconds]);

  const dismissed = wasPreviouslyDismissed || dismissedNow;

  const handleDismiss = useCallback(() => {
    setDismissedNow(true);
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
  }, []);

  if (dismissed) return null;

  // BYOK users and admin-granted unlimited (dailyLimit === 0) see a subtle Pro upsell
  if (isByokUser || dailyLimit === 0) {
    return (
      <div
        className={`${styles.banner} ${styles.info}`}
        role="status"
        aria-label="Pro upgrade suggestion"
      >
        <div className={styles.content}>
          <div>
            <p className={styles.title}>Unlimited generation active</p>
            <p className={styles.description}>
              Upgrade to Pro for private podcasts, analytics, voice tracks, and priority queue.
            </p>
          </div>
          <div className={styles.actions}>
            {waitlistState === 'success' ? (
              <span className={styles.successText}>You&apos;re on the list!</span>
            ) : (
              <button
                type="button"
                className={styles.waitlistButton}
                onClick={() => handleJoinWaitlist('pro-banner-byok')}
                disabled={waitlistState === 'loading'}
              >
                {waitlistState === 'loading' ? 'Joining...' : 'Join Pro Waitlist'}
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
              </button>
            )}
          </div>
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

  const exhausted = dailyUsed >= dailyLimit;
  const variant = exhausted ? 'exhausted' : dailyUsed >= dailyLimit - 1 ? 'warning' : 'info';
  const tierLabel = isProUser ? 'Pro' : 'Free tier';

  return (
    <div
      className={`${styles.banner} ${styles[variant]}`}
      role="status"
      aria-label={`${tierLabel} status`}
    >
      <div className={styles.content}>
        <div>
          <p className={styles.title}>
            {exhausted
              ? `Daily limit reached — ${countdown > 0 ? `resets in ${formatReset(countdown)}` : 'resets soon'}`
              : `${dailyLimit - dailyUsed} of ${dailyLimit} podcast${dailyLimit - dailyUsed !== 1 ? 's' : ''} remaining today`}
          </p>
          <p className={styles.description}>
            {exhausted
              ? isProUser
                ? 'Add your own API keys (BYOK) for unlimited generation.'
                : 'Upgrade to Pro for more daily podcasts, or add your own API keys (BYOK).'
              : `${tierLabel}: ${dailyLimit} podcast${dailyLimit !== 1 ? 's' : ''} per day.`}
          </p>
        </div>
        <div className={styles.actions}>
          {!isProUser && (
            waitlistState === 'success' ? (
              <span className={styles.successText}>You&apos;re on the list!</span>
            ) : (
              <button
                type="button"
                className={styles.waitlistButton}
                onClick={() => handleJoinWaitlist('pro-banner-free')}
                disabled={waitlistState === 'loading'}
              >
                {waitlistState === 'loading' ? 'Joining...' : 'Join Pro Waitlist'}
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
              </button>
            )
          )}
          {exhausted && (
            <Link href="/billing" className={styles.linkSecondary}>
              Add own keys
            </Link>
          )}
        </div>
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
