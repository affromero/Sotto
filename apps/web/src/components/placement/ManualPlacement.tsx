'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './ManualPlacement.module.css';

interface ManualPlacementProps {
  native: string;
  target: string;
}

type Phase = 'select' | 'submitting' | 'error';

const LEVELS: { code: string; label: string }[] = [
  { code: 'A1', label: 'Beginner' },
  { code: 'A2', label: 'Elementary' },
  { code: 'B1', label: 'Intermediate' },
  { code: 'B2', label: 'Upper-Intermediate' },
  { code: 'C1', label: 'Advanced' },
  { code: 'C2', label: 'Proficient' },
];

/**
 * The "I already know my level" on-ramp: the learner picks a CEFR level
 * directly. Warned as a guess (the test is more accurate); the course adapts as
 * they learn. Posts to /placement/manual, which only ever raises an existing
 * level — dropping down is a destructive reset elsewhere.
 */
export function ManualPlacement({ native, target }: ManualPlacementProps) {
  const router = useRouter();
  const [level, setLevel] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('select');
  const [errorMessage, setErrorMessage] = useState('');

  async function start() {
    if (!level) return;
    setPhase('submitting');
    setErrorMessage('');
    try {
      const res = await fetch('/api/v1/placement/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ native, target, level }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMessage(body.error ?? 'Could not set your level. Please try again.');
        setPhase('error');
        return;
      }
      router.push('/learn');
    } catch {
      setErrorMessage('A network error occurred. Please try again.');
      setPhase('error');
    }
  }

  if (phase === 'submitting') {
    return (
      <div className={styles.center} role="status" aria-live="polite">
        <div className={styles.spinner} aria-hidden="true" />
        <p className={styles.loadingText}>Setting up your course...</p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <p className={styles.warning} role="note">
        Picking your own level is a quick start, but the placement test is more accurate. You can
        take it anytime, and your level adjusts as you learn.
      </p>

      <fieldset className={styles.levels}>
        <legend className={styles.legend}>Choose your level</legend>
        {LEVELS.map((l) => (
          <button
            key={l.code}
            type="button"
            className={`${styles.level} ${level === l.code ? styles.levelSelected : ''}`}
            aria-pressed={level === l.code}
            onClick={() => setLevel(l.code)}
          >
            <span className={styles.levelCode}>{l.code}</span>
            <span className={styles.levelLabel}>{l.label}</span>
          </button>
        ))}
      </fieldset>

      {phase === 'error' && (
        <p className={styles.error} role="alert">
          {errorMessage}
        </p>
      )}

      <button
        type="button"
        className={styles.primaryButton}
        onClick={() => void start()}
        disabled={!level}
        aria-disabled={!level}
      >
        Start at this level
      </button>
    </div>
  );
}
