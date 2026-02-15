'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

interface ConnectFormProps {
  code: string;
}

export function ConnectForm({ code }: ConnectFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleConnect() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/connect/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to connect');
      }

      setSuccess(true);
      setTimeout(() => router.push('/settings'), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className={styles.success}>
        Telegram connected! Redirecting to settings...
      </div>
    );
  }

  return (
    <div className={styles.actions}>
      {error && <p className={styles.error}>{error}</p>}
      <button
        className={styles.connectBtn}
        onClick={handleConnect}
        disabled={loading}
      >
        {loading ? 'Connecting...' : 'Connect to Sotto'}
      </button>
    </div>
  );
}
