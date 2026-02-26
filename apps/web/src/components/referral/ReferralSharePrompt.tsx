'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import styles from './ReferralSharePrompt.module.css';

interface ReferralSharePromptProps {
  handle: string;
  hasFirstReadyPodcast: boolean;
}

const DISMISSED_KEY = 'sotto_referral_prompt_dismissed';

function isDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  return !!localStorage.getItem(DISMISSED_KEY);
}

export function ReferralSharePrompt({ handle, hasFirstReadyPodcast }: ReferralSharePromptProps) {
  const [dismissed, setDismissed] = useState(isDismissed);
  const [copied, setCopied] = useState(false);

  if (!hasFirstReadyPodcast || dismissed) return null;

  const referralUrl = `https://sotto.fm/ref/${handle}`;
  const twitterText = encodeURIComponent('I just created my first podcast on @SottoFM — where podcasts get social. Check it out:');
  const twitterShareUrl = `https://twitter.com/intent/tweet?text=${twitterText}&url=${encodeURIComponent(referralUrl)}`;

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
  }

  function copyLink() {
    navigator.clipboard.writeText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={styles.banner} role="complementary" aria-label="Share Sotto">
      <button className={styles.close} onClick={dismiss} aria-label="Dismiss">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div className={styles.content}>
        <h3 className={styles.title}>Share Sotto, earn more podcasts</h3>
        <p className={styles.description}>
          Each friend who creates their first podcast earns you +1 daily generation for 7 days (up to +5).
        </p>

        <div className={styles.actions}>
          <div className={styles.linkRow}>
            <Input value={`sotto.fm/ref/${handle}`} readOnly />
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
