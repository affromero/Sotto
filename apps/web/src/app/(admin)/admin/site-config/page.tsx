'use client';

import { useEffect, useState } from 'react';
import styles from './page.module.css';

export default function SiteConfigPage() {
  const [openSignup, setOpenSignup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    fetch('/api/admin/site-config')
      .then((r) => r.json())
      .then((data) => {
        setOpenSignup(data.openSignup);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleToggle(checked: boolean) {
    setOpenSignup(checked);
    setStatus('saving');
    try {
      const res = await fetch('/api/admin/site-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openSignup: checked }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setStatus('saved');
    } catch {
      setOpenSignup(!checked);
      setStatus('error');
    }
  }

  if (loading) return <div className={styles.container}>Loading...</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Site Config</h1>
        <p className={styles.subtitle}>
          Global settings that control site behavior. Changes take effect immediately.
        </p>
      </div>

      <div className={styles.row}>
        <div className={styles.rowLabel}>
          <div className={styles.rowLabelText}>Open Signup</div>
          <div className={styles.rowLabelDesc}>
            When enabled, anyone can sign up without a waitlist invitation.
          </div>
        </div>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            className={styles.toggleInput}
            checked={openSignup}
            onChange={(e) => handleToggle(e.target.checked)}
          />
          <span className={styles.toggleTrack} />
          <span className={styles.toggleThumb} />
        </label>
      </div>

      {status === 'saved' && (
        <p className={`${styles.status} ${styles.statusSaved}`}>Saved</p>
      )}
      {status === 'error' && (
        <p className={`${styles.status} ${styles.statusError}`}>Failed to save</p>
      )}
    </div>
  );
}
