'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TasteQuiz } from '@/components/discovery/TasteQuiz';
import type { TasteQuestion, TasteAnswer } from '@/components/discovery/TasteQuiz';
import styles from './page.module.css';

interface QuizStepProps {
  initialQuestions: TasteQuestion[];
}

export function QuizStep({ initialQuestions }: QuizStepProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const handleComplete = async (answers: TasteAnswer[]) => {
    setSaving(true);
    try {
      // Submit answers
      if (answers.length > 0) {
        await fetch('/api/taste-quiz', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers }),
        });
      }

      // Mark onboarding complete
      await fetch('/api/onboarding/complete', { method: 'POST' });

      router.push('/create');
    } catch {
      setSaving(false);
    }
  };

  const handleRequestMore = async (): Promise<TasteQuestion[]> => {
    const res = await fetch('/api/taste-quiz?count=10');
    if (!res.ok) return [];
    const data = await res.json();
    return data.questions;
  };

  const handleSkipAll = async () => {
    setSaving(true);
    try {
      await fetch('/api/onboarding/complete', { method: 'POST' });
      router.push('/create');
    } catch {
      setSaving(false);
    }
  };

  if (saving) {
    return (
      <div className={styles.actions}>
        <p>Setting up your feed...</p>
      </div>
    );
  }

  return (
    <TasteQuiz
      initialQuestions={initialQuestions}
      onComplete={handleComplete}
      onRequestMore={handleRequestMore}
      onSkipAll={handleSkipAll}
    />
  );
}
