'use client';

import { useState, useCallback } from 'react';
import styles from './ProWaitlistButton.module.css';

interface ProWaitlistButtonProps {
  email: string;
  source: string;
  label?: string;
  className?: string;
}

export function ProWaitlistButton({
  email,
  source,
  label = 'Join Pro Waitlist',
  className,
}: ProWaitlistButtonProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'success'>('idle');

  const handleClick = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch('/api/v1/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source }),
      });
      if (!res.ok) throw new Error();
      setState('success');
    } catch {
      setState('success');
    }
  }, [email, source]);

  if (state === 'success') {
    return (
      <span className={`${styles.success} ${className ?? ''}`}>
        You&apos;re on the list!
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'loading'}
      className={`${styles.button} ${className ?? ''}`}
    >
      {state === 'loading' ? 'Joining...' : label}
    </button>
  );
}
