'use client';

import { useState } from 'react';
import { Glyph } from '@/components/Glyph';
import styles from './FactoryResetPanel.module.css';

type ResetStatus = 'idle' | 'confirming' | 'resetting' | 'reset' | 'error';

export function FactoryResetPanel() {
  const [status, setStatus] = useState<ResetStatus>('idle');

  async function runFactoryReset() {
    setStatus('resetting');
    try {
      const res = await fetch('/api/v1/admin/factory-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE EVERYTHING' }),
      });
      if (!res.ok) throw new Error('Failed to reset');
      const body = (await res.json().catch(() => null)) as { redirectTo?: string } | null;
      setStatus('reset');
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('sotto.onboarding.v1');
        window.localStorage.removeItem('sotto-theme');
        window.localStorage.removeItem('sotto-palette');
        window.localStorage.removeItem('sotto-accent');
        window.localStorage.removeItem('sotto-motion');
        window.location.assign(body?.redirectTo ?? '/welcome?reset=1');
      }
    } catch {
      setStatus('error');
    }
  }

  const isBusy = status === 'resetting';

  return (
    <section className={styles.panel} aria-labelledby="factory-reset-title">
      <div className={styles.summary}>
        <div className={styles.icon}>
          <Glyph name="gear" size={18} />
        </div>
        <div>
          <h2 id="factory-reset-title" className={styles.title}>
            Reset learning data
          </h2>
          <p className={styles.copy}>
            Permanently erase generated lessons, courses, media, queues, and learner preferences.
            Access, passkeys, profiles, provider credentials, and server settings remain available
            so the instance cannot lock its owner out.
          </p>
        </div>
      </div>

      {status === 'confirming' ? (
        <div
          className={styles.confirmBanner}
          aria-labelledby="factory-reset-confirm-title"
          aria-describedby="factory-reset-confirm-copy"
        >
          <div>
            <h3 id="factory-reset-confirm-title" className={styles.confirmTitle}>
              Confirm learning-data reset
            </h3>
            <p id="factory-reset-confirm-copy" className={styles.confirmCopy}>
              This cannot be undone. Generated learning data and files are deleted. Every profile
              returns to onboarding with its existing sign-in and provider access intact.
            </p>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.confirmButton}
              onClick={runFactoryReset}
              disabled={isBusy}
            >
              {isBusy ? 'Resetting...' : 'Delete learning data'}
            </button>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => setStatus('idle')}
              disabled={isBusy}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.resetButton}
          onClick={() => setStatus('confirming')}
          disabled={isBusy}
        >
          Reset learning data
        </button>
      )}

      {status === 'reset' && (
        <div className={`${styles.result} ${styles.success}`} role="status">
          Learning data reset complete. Redirecting to setup...
        </div>
      )}
      {status === 'error' && (
        <div className={`${styles.result} ${styles.error}`} role="status">
          Failed to reset learning data.
        </div>
      )}
    </section>
  );
}
