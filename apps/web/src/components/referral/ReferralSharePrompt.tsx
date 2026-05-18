'use client';

import { useState, useSyncExternalStore } from 'react';
import { BRAND } from '@sotto/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import styles from './ReferralSharePrompt.module.css';

interface ReferralSharePromptProps {
  handle: string;
  hasFirstReadyPodcast: boolean;
}

const DISMISSED_KEY = 'sotto_referral_prompt_dismissed';

let dismissListeners: Array<() => void> = [];

function subscribeDismissed(listener: () => void) {
  dismissListeners = [...dismissListeners, listener];
  return () => {
    dismissListeners = dismissListeners.filter((l) => l !== listener);
  };
}

function getDismissedSnapshot(): boolean {
  return !!localStorage.getItem(DISMISSED_KEY);
}

function getDismissedServerSnapshot(): boolean {
  return true;
}

function setDismissed() {
  localStorage.setItem(DISMISSED_KEY, '1');
  dismissListeners.forEach((l) => l());
}

export function ReferralSharePrompt({ handle, hasFirstReadyPodcast }: ReferralSharePromptProps) {
  const dismissed = useSyncExternalStore(
    subscribeDismissed,
    getDismissedSnapshot,
    getDismissedServerSnapshot
  );
  const [copied, setCopied] = useState(false);

  if (!hasFirstReadyPodcast || dismissed) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const referralUrl = `${origin}/ref/${handle}`;
  const referralDisplayUrl = origin ? referralUrl.replace(/^https?:\/\//, '') : `/ref/${handle}`;
  const twitterText = encodeURIComponent(
    `I just created my first podcast on ${BRAND.twitter} — ${BRAND.tagline} Check it out:`
  );
  const twitterShareUrl = `https://twitter.com/intent/tweet?text=${twitterText}&url=${encodeURIComponent(referralUrl)}`;

  function dismiss() {
    setDismissed();
  }

  function copyLink() {
    navigator.clipboard.writeText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={styles.banner} role="complementary" aria-label="Share Sotto">
      <button className={styles.close} onClick={dismiss} aria-label="Dismiss">
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

      <div className={styles.content}>
        <h3 className={styles.title}>Share Sotto, earn more podcasts</h3>
        <p className={styles.description}>
          Each friend who creates their first podcast earns you +1 daily generation for 7 days (up
          to +5).
        </p>

        <div className={styles.actions}>
          <div className={styles.linkRow}>
            <Input value={referralDisplayUrl} readOnly />
            <Button variant="secondary" onClick={copyLink}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <a
            href={twitterShareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.twitterButton}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Share on X
          </a>
        </div>
      </div>
    </div>
  );
}
