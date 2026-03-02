'use client';

import { useState } from 'react';
import { getLanguageLabel } from '@sotto/shared';
import styles from './LanguageBanner.module.css';

interface LanguageBannerProps {
  detectedLanguage: string;
  onDismiss: () => void;
}

export function LanguageBanner({ detectedLanguage, onDismiss }: LanguageBannerProps) {
  const [switching, setSwitching] = useState(false);
  const languageName = getLanguageLabel(detectedLanguage) ?? detectedLanguage.toUpperCase();

  const handleSwitch = async () => {
    setSwitching(true);
    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredLanguage: detectedLanguage }),
      });
      if (res.ok) {
        onDismiss();
      }
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className={styles.banner} role="status" aria-label="Language suggestion">
      <div className={styles.content}>
        <p className={styles.message}>
          It looks like you write in {languageName}. Want your podcasts in {languageName} too?
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.switchButton}
            onClick={handleSwitch}
            disabled={switching}
          >
            {switching ? 'Switching...' : `Switch to ${languageName}`}
          </button>
          <button
            type="button"
            className={styles.keepButton}
            onClick={onDismiss}
          >
            Keep English
          </button>
        </div>
      </div>
      <button
        type="button"
        className={styles.dismissButton}
        onClick={onDismiss}
        aria-label="Dismiss language suggestion"
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
