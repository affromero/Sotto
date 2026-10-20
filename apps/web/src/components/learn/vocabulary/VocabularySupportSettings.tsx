'use client';

import { useState } from 'react';
import type { VocabularySupport } from '@sotto/shared';
import { Button } from '@/components/ui/Button';
import { VocabularySupportPicker } from './VocabularySupportPicker';
import styles from './VocabularySupportSettings.module.css';

export function VocabularySupportSettings({
  courseId,
  current,
}: {
  courseId: string;
  current: VocabularySupport | null;
}) {
  const [value, setValue] = useState(current);
  const [saved, setSaved] = useState(current);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function save() {
    setStatus('saving');
    try {
      const response = await fetch(`/api/v1/courses/${courseId}/vocabulary-support`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularySupport: value }),
      });
      if (!response.ok) throw new Error('Vocabulary support was not saved.');
      setSaved(value);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className={styles.root}>
      <VocabularySupportPicker
        value={value}
        onChange={(next) => {
          setValue(next);
          setStatus('idle');
        }}
        disabled={status === 'saving'}
      />
      <Button
        type="button"
        onClick={() => void save()}
        disabled={status === 'saving' || value === saved}
      >
        {status === 'saving' ? 'Saving…' : 'Save vocabulary support'}
      </Button>
      <p className={styles.status} role="status">
        {status === 'saved' && 'Saved. Applies to your next class and practice.'}
        {status === 'error' && 'Could not save. Your selection is still here. Try again.'}
      </p>
    </div>
  );
}
