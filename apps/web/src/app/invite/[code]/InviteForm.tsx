'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

interface InviteFormProps {
  code: string;
}

export function InviteForm({ code }: InviteFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/v1/invite/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, email }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(typeof data.error === 'string' ? data.error : 'Something went wrong');
        return;
      }

      router.push('/auth/login');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <input
        type="email"
        className={styles.emailInput}
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoFocus
        aria-label="Email address"
        inputMode="email"
        enterKeyHint="go"
        autoComplete="email"
      />
      <button
        type="submit"
        className={styles.submitBtn}
        disabled={submitting || !email}
      >
        {submitting ? 'Redeeming...' : 'Accept Invitation'}
      </button>
      {error && <p className={styles.error}>{error}</p>}
      <p className={styles.hint}>
        Use the same email for Google or Apple sign-in after accepting.
      </p>
    </form>
  );
}
