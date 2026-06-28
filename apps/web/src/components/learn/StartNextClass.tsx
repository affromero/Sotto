'use client';

import { useState } from 'react';
import { useEffect } from 'react';
import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { SottoSpinner } from '@/components/ui/SottoSpinner';
import styles from './StartNextClass.module.css';

interface StartNextClassProps {
  courseId: string;
  activeClassId: string | null;
}

type Phase = 'idle' | 'generating' | 'done';

interface GenerationProgress {
  status: string;
  classId: string | null;
  lessonTitle: string | null;
  stage: string;
  detail: string;
  progress: number;
  currentStep: number;
  totalSteps: number;
  elapsedSeconds: number | null;
}

export function StartNextClass({ courseId, activeClassId }: StartNextClassProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState<GenerationProgress | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isMonitoringExisting, setIsMonitoringExisting] = useState(false);
  const activeController = useRef<AbortController | null>(null);
  const buttonLabel = activeClassId ? 'Resume class' : 'Take a class';

  useEffect(() => {
    return () => {
      activeController.current?.abort();
      activeController.current = null;
    };
  }, []);

  function stopPolling(controller: AbortController) {
    controller.abort();
    if (activeController.current === controller) {
      activeController.current = null;
    }
  }

  function startPolling(monitoringExisting: boolean) {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setIsMonitoringExisting(monitoringExisting);
    setPhase('generating');
    void pollGenerationProgress(controller.signal);
    return controller;
  }

  async function handleContinue() {
    setError('');
    setGeneration(null);

    if (activeClassId) {
      startPolling(true);
      return;
    }

    const controller = startPolling(false);
    let keepPolling = false;

    try {
      const res = await fetch(`/api/v1/courses/${courseId}/next-class`, {
        method: 'POST',
        signal: controller.signal,
      });

      if (res.status === 201) {
        keepPolling = true;
        return;
      }

      if (res.status === 409) {
        const data = (await res.json()) as {
          activeClassId?: string;
          status?: string;
          cancelled?: boolean;
        };
        if (data.status === 'GENERATING') {
          keepPolling = true;
          return;
        }
        if (data.cancelled) {
          stopPolling(controller);
          setPhase('idle');
          setGeneration(null);
          return;
        }
        if (data.activeClassId) {
          keepPolling = true;
          return;
        }
        stopPolling(controller);
        setError('Sotto is already working on this course. Please try again in a moment.');
        setPhase('idle');
        return;
      }

      if (res.status === 200) {
        const data = (await res.json()) as { done?: boolean };
        if (data.done) {
          stopPolling(controller);
          setPhase('done');
          return;
        }
      }

      const body = (await res.json().catch(() => ({}))) as { error?: string };
      stopPolling(controller);
      setError(body.error ?? 'Something went wrong. Please try again.');
      setPhase('idle');
    } catch (err) {
      if (isAbortError(err)) return;

      const progress = await fetchGenerationProgress().catch(() => null);
      if (progress?.status === 'GENERATING') {
        keepPolling = true;
        setError('');
        return;
      }

      stopPolling(controller);
      setError('Sotto request timed out. Retry the class or cancel and start again.');
      setPhase('idle');
    } finally {
      if (!keepPolling) {
        stopPolling(controller);
      }
    }
  }

  async function handleCancel() {
    setIsCancelling(true);
    setError('');
    activeController.current?.abort();

    try {
      const res = await fetch(`/api/v1/courses/${courseId}/generation`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Could not cancel this class. Please try again.');
        setGeneration(null);
        setPhase('idle');
        return;
      }
      setGeneration(null);
      setPhase('idle');
      router.refresh();
    } catch {
      setError('Could not reach Sotto to cancel this class.');
      setGeneration(null);
      setPhase('idle');
    } finally {
      activeController.current = null;
      setIsCancelling(false);
    }
  }

  async function fetchGenerationProgress(signal?: AbortSignal) {
    const res = await fetch(`/api/v1/courses/${courseId}/generation`, {
      cache: 'no-store',
      signal,
    });
    if (!res.ok) return null;

    const progress = (await res.json()) as GenerationProgress;
    setGeneration(progress);
    return progress;
  }

  async function pollGenerationProgress(signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        const progress = await fetchGenerationProgress(signal);
        if (isClassReadyToOpen(progress)) {
          activeController.current?.abort();
          activeController.current = null;
          router.push(`/learn/class/${progress.classId}`);
          return;
        }
      } catch (err) {
        if (isAbortError(err)) return;
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
      ? `${isMonitoringExisting ? 'Preparing' : 'Generating'} ${generation.lessonTitle}`
      : isMonitoringExisting
        ? 'Preparing this class'
        : 'Composing your class';
    const detail =
      generation?.detail ?? 'Sotto is preparing the questions, audio, and prompts for this class.';
    const meta = generation
      ? `Step ${generation.currentStep || 1} of ${generation.totalSteps}`
      : 'Starting generation';
    const canCancel = !isMonitoringExisting && (!generation || generation.status === 'GENERATING');

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
        <div className={styles.composingActions}>
          <span className={styles.composingMeta}>{meta}</span>
          {canCancel ? (
            <button
              type="button"
              className={styles.cancelButton}
              onClick={handleCancel}
              disabled={isCancelling}
            >
              {isCancelling ? 'Cancelling...' : 'Cancel generation'}
            </button>
          ) : null}
        </div>
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

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isClassReadyToOpen(
  progress: GenerationProgress | null
): progress is GenerationProgress & { classId: string } {
  return Boolean(
    progress?.classId &&
    progress.status !== 'GENERATING' &&
    progress.status !== 'IDLE' &&
    progress.progress >= 1
  );
}
