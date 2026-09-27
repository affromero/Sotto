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
  operationId?: string;
  operationStatus?: string;
  result?: string | null;
}

interface PreparationActivity {
  aiProvider: string;
  aiModel: string;
  availableAt: string;
  timeZone: string;
  maxProviderRequests: number | null;
  providerRequestsAdmitted: number | null;
  events?: { sequence: number; at: number; type: string }[];
  truncated?: boolean;
  next?: number;
  latest?: number;
}

export function StartNextClass({ courseId, activeClassId }: StartNextClassProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState<GenerationProgress | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isMonitoringExisting, setIsMonitoringExisting] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [requestLimit, setRequestLimit] = useState(128);
  const [activity, setActivity] = useState<PreparationActivity | null>(null);
  const [acknowledgeUnknownOutcome, setAcknowledgeUnknownOutcome] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
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

  function startPolling(monitoringExisting: boolean, pollNow = true) {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setIsMonitoringExisting(monitoringExisting);
    setActivity(null);
    setPhase('generating');
    if (pollNow) void pollGenerationProgress(controller.signal, monitoringExisting);
    return controller;
  }

  async function handleContinue() {
    setError('');
    setGeneration(null);

    if (activeClassId) {
      startPolling(true);
      return;
    }

    const controller = startPolling(false, false);
    let keepPolling = false;

    try {
      const res = await fetch(`/api/v1/courses/${courseId}/next-class`, {
        method: 'POST',
        headers: { Prefer: 'respond-async' },
        signal: controller.signal,
      });

      if (res.status === 201 || res.status === 202) {
        keepPolling = true;
        void pollGenerationProgress(controller.signal, false);
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
          void pollGenerationProgress(controller.signal, true);
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
          void pollGenerationProgress(controller.signal, true);
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
        void pollGenerationProgress(controller.signal, true);
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
      const body = (await res.json()) as { cancelling?: boolean };
      if (body.cancelling) {
        startPolling(true);
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
      setIsCancelling(false);
    }
  }

  async function handleSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const date = new Date(scheduledAt);
    if (!Number.isFinite(date.getTime())) {
      setError('Choose a preparation time.');
      return;
    }
    try {
      const response = await fetch(`/api/v1/courses/${courseId}/preparation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          availableAt: date.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          maxProviderRequests: requestLimit,
          deferAudio: true,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: unknown };
        setError(typeof body.error === 'string' ? body.error : 'Could not schedule preparation.');
        return;
      }
      startPolling(true);
    } catch {
      setError('Could not reach Sotto to schedule preparation.');
    }
  }

  async function handleRecovery() {
    setIsRecovering(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/courses/${courseId}/preparation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledgeUnknownOutcome }),
      });
      const body = (await response.json()) as { error?: string; status?: string };
      if (!response.ok) {
        setError(body.error ?? 'Cleanup could not be confirmed.');
        return;
      }
      setAcknowledgeUnknownOutcome(false);
      startPolling(true);
    } catch {
      setError('Could not reach Sotto to recover preparation.');
    } finally {
      setIsRecovering(false);
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
    if (progress.operationId) {
      try {
        const result = await fetch(`/api/v1/courses/${courseId}/preparation?limit=100`, {
          cache: 'no-store',
          signal,
        });
        if (result.ok && !signal?.aborted) {
          const first = (await result.json()) as PreparationActivity;
          if (first.next !== undefined && first.latest !== undefined && first.next < first.latest) {
            const rest = await fetch(
              `/api/v1/courses/${courseId}/preparation?limit=100&after=${first.next}`,
              { cache: 'no-store', signal }
            );
            if (rest.ok) {
              const page = (await rest.json()) as PreparationActivity;
              first.events = [...(first.events ?? []), ...(page.events ?? [])].slice(-128);
              first.truncated ||= page.truncated;
            }
          }
          if (!signal?.aborted) setActivity(first);
        }
      } catch (error) {
        if (isAbortError(error)) throw error;
      }
    } else {
      setActivity(null);
    }
    return progress;
  }

  async function pollGenerationProgress(signal: AbortSignal, monitoringExisting: boolean) {
    while (!signal.aborted) {
      try {
        const progress = await fetchGenerationProgress(signal);
        if (signal.aborted) return;
        if (monitoringExisting && progress?.status === 'IDLE') {
          if (activeController.current) stopPolling(activeController.current);
          setPhase('idle');
          setError('No preparation is currently scheduled.');
          return;
        }
        if (progress?.result === 'done') {
          if (activeController.current) stopPolling(activeController.current);
          setPhase('done');
          return;
        }
        if (progress && ['FAILED', 'UNRESOLVED', 'CANCELLED'].includes(progress.status)) {
          activeController.current?.abort();
          activeController.current = null;
          setError(progress.status === 'CANCELLED' ? '' : progress.detail);
          setPhase('idle');
          return;
        }
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

  const activityView = activity && (
    <details className={styles.schedule}>
      <summary>Preparation activity</summary>
      <p>
        {activity.aiProvider}: {activity.aiModel}
      </p>
      <p>
        Scheduled:{' '}
        {new Date(activity.availableAt).toLocaleString(undefined, { timeZone: activity.timeZone })}{' '}
        ({activity.timeZone})
      </p>
      <p>
        {activity.maxProviderRequests === null
          ? 'Model requests are not counted for this manual preparation.'
          : `${activity.providerRequestsAdmitted ?? 0} of ${activity.maxProviderRequests} model requests admitted, including retries.`}
      </p>
      {activity.truncated && <p>Older activity is no longer retained.</p>}
      <ol>
        {activity.events?.map((event) => (
          <li key={event.sequence}>
            {event.type.replaceAll('_', ' ')} at {new Date(event.at).toLocaleTimeString()}
          </li>
        ))}
      </ol>
    </details>
  );
  const recoveryView = generation && ['UNRESOLVED', 'CANCELLING'].includes(generation.status) && (
    <div className={styles.schedule}>
      <p>
        Recovery checks that local work has stopped. It does not repeat the interrupted request.
      </p>
      <label className={styles.recoveryConsent}>
        <input
          type="checkbox"
          checked={acknowledgeUnknownOutcome}
          onChange={(event) => setAcknowledgeUnknownOutcome(event.target.checked)}
        />
        I understand that the provider may have charged for an interrupted request.
      </label>
      <button
        type="button"
        className={styles.button}
        disabled={!acknowledgeUnknownOutcome || isRecovering}
        onClick={handleRecovery}
      >
        {isRecovering ? 'Checking cleanup...' : 'Check cleanup and recover'}
      </button>
    </div>
  );

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
    const canCancel = !generation || generation.status === 'GENERATING';

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
        {activityView}
        {recoveryView}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
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
      {activityView}
      {recoveryView}
      <button
        type="button"
        className={styles.button}
        onClick={handleContinue}
        aria-label={activeClassId ? 'Resume active class' : 'Take a class at this level'}
      >
        {buttonLabel}
      </button>
      <button type="button" className={styles.cancelButton} onClick={() => startPolling(true)}>
        Check preparation
      </button>
      {!activeClassId && (
        <details className={styles.schedule}>
          <summary>Prepare a class later</summary>
          <form onSubmit={handleSchedule}>
            <p>
              Prepare once within the next seven days, using your selected API model. Audio is
              generated only after you review the class and request it.
            </p>
            <p>
              Preparation uses your course level, saved course notes, and review targets. You can
              edit your notes and vocabulary before the task runs.
            </p>
            <label>
              Preparation time (your local time)
              <input
                type="datetime-local"
                required
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
            </label>
            <label>
              Maximum model requests, including retries
              <input
                type="number"
                min={1}
                max={256}
                required
                value={requestLimit}
                onChange={(event) => setRequestLimit(Number(event.target.value))}
              />
            </label>
            <p>
              This limits requests, not currency. Provider charges depend on the model and tokens
              used.
            </p>
            <button className={styles.button} type="submit">
              Schedule preparation
            </button>
          </form>
        </details>
      )}
    </div>
  );
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timeout = window.setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
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
