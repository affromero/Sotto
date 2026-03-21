'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { validateDisplayName } from '@/lib/name-validation';
import styles from './NameStep.module.css';

export function NameStep() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();

    // Client-side validation for instant feedback
    const check = validateDisplayName(trimmed);
    if (!check.valid) {
      setError(check.reason!);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/onboarding/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Something went wrong');
        setSaving(false);
        return;
      }

      // Server component will re-query user.name and show the taste quiz
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div className={styles.root}>
      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          type="text"
          className={styles.input}
          placeholder="Your name"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          disabled={saving}
          autoComplete="name"
          autoFocus
          aria-label="Display name"
          enterKeyHint="done"
          aria-invalid={error ? 'true' : undefined}
          maxLength={100}
        />
        <button
          type="submit"
          className={styles.submitBtn}
          disabled={saving || name.trim().length < 2}
        >
          {saving ? 'Saving...' : 'Continue'}
        </button>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </form>
    </div>
  );
}
