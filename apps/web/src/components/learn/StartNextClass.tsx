'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SottoSpinner } from '@/components/ui/SottoSpinner';
import styles from './StartNextClass.module.css';

interface StartNextClassProps {
  courseId: string;
  activeClassId: string | null;
}

type Phase = 'idle' | 'generating' | 'done';

interface GenerationProgress {
  lessonTitle: string | null;
  stage: string;
  detail: string;
  progress: number;
  currentStep: number;
  totalSteps: number;
  elapsedSeconds: number | null;
  remainingSeconds: number | null;
}

export function StartNextClass({ courseId, activeClassId }: StartNextClassProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState<GenerationProgress | null>(null);
  const buttonLabel = activeClassId ? 'Resume class' : 'Take a class';

  async function handleContinue() {
    setError('');
    setGeneration(null);

    // If there is already an active class, navigate directly to it.
    if (activeClassId) {
      router.push(`/learn/class/${activeClassId}`);
      return;
    }

    setPhase('generating');
    const controller = new AbortController();
    const polling = pollGenerationProgress(controller.signal);

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
    } finally {
      controller.abort();
      void polling.catch(() => {});
    }
  }

  async function pollGenerationProgress(signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        const res = await fetch(`/api/v1/courses/${courseId}/generation`, {
          cache: 'no-store',
          signal,
        });
        if (res.ok) {
          setGeneration((await res.json()) as GenerationProgress);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }

      await wait(1500, signal);
    }
  }

  if (phase === 'done') {
    return (
      <p className={styles.done} role="status">
        Course complete
      </p>
    );
  }

  if (phase === 'generating') {
    const progress = generation?.progress ?? null;
    const title = generation?.lessonTitle
      ? `Generating ${generation.lessonTitle}`
      : 'Composing your class';
    const detail =
      generation?.detail ?? 'Sotto is preparing the questions, audio, and prompts for this class.';

    return (
      <div
        className={styles.composing}
        role="status"
        aria-live="polite"
        aria-label="Composing your next class, please wait"
      >
        <SottoSpinner
          size="large"
          progress={progress}
          label={title}
          detail={detail}
          showPercent
          orientation="stack"
          ariaLabel="Composing your next class"
        />
        {generation && (
          <span className={styles.composingMeta}>
            Step {generation.currentStep || 1} of {generation.totalSteps}
            {' · '}
            {timeSummary(generation)}
          </span>
        )}
      </div>
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
        aria-label={activeClassId ? 'Resume active class' : 'Take a class at this level'}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

function timeSummary(progress: GenerationProgress): string {
  const elapsed = formatDuration(progress.elapsedSeconds);
  if (progress.remainingSeconds === null) return `Elapsed ${elapsed}`;
  return `Elapsed ${elapsed}, about ${formatDuration(progress.remainingSeconds)} left`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '0:00';
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}
