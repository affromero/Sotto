'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './StartNextClass.module.css';

interface StartNextClassProps {
  courseId: string;
  activeClassId: string | null;
}

type Phase = 'idle' | 'generating' | 'done';

export function StartNextClass({ courseId, activeClassId }: StartNextClassProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');

  async function handleContinue() {
    setError('');

    // If there is already an active class, navigate directly to it.
    if (activeClassId) {
      router.push(`/learn/class/${activeClassId}`);
      return;
    }

    setPhase('generating');

    try {
      const res = await fetch(`/api/v1/courses/${courseId}/next-class`, { method: 'POST' });

      if (res.status === 201) {
        const data = (await res.json()) as { classId: string };
        router.push(`/learn/class/${data.classId}`);
        return;
      }

      if (res.status === 409) {
        const data = (await res.json()) as { activeClassId: string };
        router.push(`/learn/class/${data.activeClassId}`);
        return;
      }

      if (res.status === 200) {
        const data = (await res.json()) as { done?: boolean };
        if (data.done) {
          setPhase('done');
          return;
        }
      }

      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'Something went wrong. Please try again.');
      setPhase('idle');
    } catch {
      setError('Network error. Please try again.');
      setPhase('idle');
    }
  }

  if (phase === 'done') {
    return (
      <p className={styles.done} role="status">
        Course complete
      </p>
    );
  }

  return (
    <div className={styles.root}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className={styles.button}
        onClick={handleContinue}
        disabled={phase === 'generating'}
        aria-busy={phase === 'generating'}
        aria-label={phase === 'generating' ? 'Generating next class, please wait' : 'Continue to next class'}
      >
        {phase === 'generating' ? (
          <>
            <span className={styles.spinner} aria-hidden="true" />
            Generating…
          </>
        ) : (
          'Continue'
        )}
      </button>
    </div>
  );
}
