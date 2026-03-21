'use client';

import { useState, useCallback } from 'react';
import styles from './ProWaitlistForm.module.css';

interface ProWaitlistFormProps {
  source: string;
  buttonLabel?: string;
  variant?: 'featured' | 'secondary';
  className?: string;
}

export function ProWaitlistForm({
  source,
  buttonLabel = 'Join Pro Waitlist',
  variant = 'featured',
  className,
}: ProWaitlistFormProps) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.trim()) return;

      setState('loading');
      try {
        const res = await fetch('/api/waitlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), source }),
        });
        if (!res.ok) throw new Error();
        setState('success');
      } catch {
        setState('error');
      }
    },
    [email, source],
  );

  if (state === 'success') {
    return (
      <p className={`${styles.success} ${className ?? ''}`}>
        You&apos;re on the list! We&apos;ll email you when Pro launches.
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`${styles.form} ${className ?? ''}`}
    >
      <input
        type="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={styles.input}
        disabled={state === 'loading'}
        aria-label="Email address for Pro waitlist"
        inputMode="email"
        enterKeyHint="done"
        autoComplete="email"
      />
      <button
        type="submit"
        disabled={state === 'loading'}
        className={`${styles.button} ${styles[variant]}`}
      >
        {state === 'loading' ? 'Joining...' : buttonLabel}
      </button>
      {state === 'error' && (
        <p className={styles.error}>Something went wrong. Please try again.</p>
      )}
    </form>
  );
}
