'use client';

import { useState } from 'react';
import { PEDAGOGY_STYLES, getPedagogyStyle } from '@/lib/pedagogy';
import type { PedagogyStyle } from '@sotto/shared';
import styles from './PedagogySelector.module.css';

interface Props {
  courseId: string;
  current: PedagogyStyle;
}

/**
 * Lets a learner switch the course's teaching approach when one is not working.
 * It shapes the next generated class, practice, and exam (existing content is
 * unchanged), so the copy says so. Each option shows the research it draws on.
 */
export function PedagogySelector({ courseId, current }: Props) {
  const [value, setValue] = useState<PedagogyStyle>(current);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function change(next: PedagogyStyle) {
    const previous = value;
    setValue(next);
    setStatus('saving');
    try {
      const res = await fetch(`/api/v1/courses/${courseId}/pedagogy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedagogy: next }),
      });
      if (!res.ok) throw new Error('failed');
      setStatus('saved');
    } catch {
      setValue(previous);
      setStatus('error');
    }
  }

  const info = getPedagogyStyle(value);

  return (
    <div className={styles.root}>
      <label className={styles.label} htmlFor={`pedagogy-${courseId}`}>
        Teaching approach
      </label>
      <select
        id={`pedagogy-${courseId}`}
        className={styles.select}
        value={value}
        onChange={(e) => change(e.target.value as PedagogyStyle)}
      >
        {PEDAGOGY_STYLES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <p className={styles.hint}>
        {info.summary} <span className={styles.basis}>Based on: {info.basis}</span>
      </p>
      <p className={styles.note} aria-live="polite">
        {status === 'saving' && 'Saving…'}
        {status === 'saved' && 'Applies to your next class, practice, and exam.'}
        {status === 'error' && 'Could not save. Try again.'}
      </p>
    </div>
  );
}
