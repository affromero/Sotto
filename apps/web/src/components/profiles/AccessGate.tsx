'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './AccessGate.module.css';

/**
 * Instance access gate for publicly exposed installs: one shared password
 * (set by the admin via SOTTO_ACCESS_PASSWORD) opens the household. Shown
 * before the profile picker; invite links/QRs skip it entirely.
 */
export function AccessGate() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/v1/gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push('/profiles');
        router.refresh();
        return;
      }

      if (res.status === 429) {
        setError('Too many attempts. Wait a moment, then try again.');
      } else {
        setError('That password is not right. Ask the admin for the current one.');
      }
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.brand}>Sotto</div>
      <h1 className={styles.heading}>This space is private</h1>
      <p className={styles.sub}>Household access</p>

      <form className={styles.form} onSubmit={submit}>
        <label className={styles.label} htmlFor="access-password">
          Access password
        </label>
        <input
          id="access-password"
          className={styles.input}
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
        {error ? <p className={styles.error}>{error}</p> : null}
        <button className={styles.button} type="submit" disabled={busy || !password}>
          {busy ? 'Checking…' : 'Enter'}
        </button>
      </form>

      <p className={styles.hint}>
        The admin set an access password for this household. Ask them for it, or use an invite link
        or QR code from their Settings.
      </p>
    </div>
  );
}
