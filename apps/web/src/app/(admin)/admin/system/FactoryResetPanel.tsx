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
      setStatus('reset');
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('sotto.onboarding.v1');
        window.localStorage.removeItem('sotto-theme');
        window.localStorage.removeItem('sotto-palette');
        window.localStorage.removeItem('sotto-accent');
        window.localStorage.removeItem('sotto-motion');
        window.location.assign('/welcome');
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
            Factory reset
          </h2>
          <p className={styles.copy}>
            Permanently erase profiles, generated lessons, courses, generated media, provider keys,
            queues, and admin settings. Sotto will restart at the initial setup wizard.
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
              Confirm factory reset
            </h3>
            <p id="factory-reset-confirm-copy" className={styles.confirmCopy}>
              This cannot be undone. All household data and generated files are deleted, the owner
              profile is recreated, and onboarding starts over.
            </p>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.confirmButton}
              onClick={runFactoryReset}
              disabled={isBusy}
            >
              {isBusy ? 'Resetting...' : 'Delete everything and reset'}
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
          Factory reset
        </button>
      )}

      {status === 'reset' && (
        <div className={`${styles.result} ${styles.success}`} role="status">
          Factory reset complete. Redirecting to setup...
        </div>
      )}
      {status === 'error' && (
        <div className={`${styles.result} ${styles.error}`} role="status">
          Failed to factory reset.
        </div>
      )}
    </section>
  );
}
