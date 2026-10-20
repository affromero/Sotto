'use client';

import { useState } from 'react';
import { useEffect } from 'react';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SottoSpinner } from '@/components/ui/SottoSpinner';
import styles from './StartNextClass.module.css';

interface StartNextClassProps {
  courseId: string;
  activeClassId: string | null;
  children?: ReactNode;
}

type Phase = 'idle' | 'generating' | 'done' | 'requirements';

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
  availableAt?: string;
  timeZone?: string;
}

interface PreparationActivity {
  aiProvider: string;
  aiModel: string;
  availableAt: string;
  timeZone: string;
  maxProviderRequests: number | null;
  providerRequestsAdmitted: number | null;
  failureReason?: string;
  events?: { sequence: number; at: number; type: string }[];
  truncated?: boolean;
  next?: number;
  latest?: number;
}

export function StartNextClass({ courseId, activeClassId, children }: StartNextClassProps) {
  return (
    <CourseClassPreparation key={courseId} courseId={courseId} activeClassId={activeClassId}>
      {children}
    </CourseClassPreparation>
  );
}

function CourseClassPreparation({ courseId, activeClassId, children }: StartNextClassProps) {
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
  const inspectionController = useRef<AbortController | null>(null);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const buttonLabel = activeClassId ? 'Resume class' : 'Take a class';

  useEffect(() => {
    const controller = new AbortController();
    inspectionController.current = controller;
    void fetch(`/api/v1/courses/${courseId}/generation`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Preparation status is unavailable');
        const progress = (await response.json()) as GenerationProgress;
        if (!controller.signal.aborted) setGeneration(progress);
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatusUnavailable(true);
      });
    return () => controller.abort();
  }, [courseId]);

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

  function startPolling(monitoringExisting: boolean, pollNow = true, openWhenReady = true) {
    inspectionController.current?.abort();
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setIsMonitoringExisting(monitoringExisting);
    setActivity(null);
    setPhase('generating');
    if (pollNow) void pollGenerationProgress(controller.signal, monitoringExisting, openWhenReady);
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
        const data = (await res.json()) as { done?: boolean; requirementsRemaining?: boolean };
        if (data.requirementsRemaining) {
          stopPolling(controller);
          setPhase('requirements');
          return;
        }
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
        startPolling(true, true, false);
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
    inspectionController.current?.abort();
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
      startPolling(true, true, false);
    } catch {
      setError('Could not reach Sotto to schedule preparation.');
    }
  }

  async function handleRecovery() {
    activeController.current?.abort();
    activeController.current = null;
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
      startPolling(true, true, false);
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
    if (!res.ok) throw new Error('Could not read class preparation status.');

    const progress = (await res.json()) as GenerationProgress;
    if (signal?.aborted) return null;
    setGeneration(progress);
    setStatusUnavailable(false);
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

  async function pollGenerationProgress(
    signal: AbortSignal,
    monitoringExisting: boolean,
    openWhenReady = true
  ) {
    while (!signal.aborted) {
      try {
        const progress = await fetchGenerationProgress(signal);
        if (signal.aborted) return;
        if (monitoringExisting && progress?.status === 'IDLE') {
          if (activeController.current) stopPolling(activeController.current);
          setPhase('idle');
          setError('');
          return;
        }
        if (progress?.result === 'done') {
          if (activeController.current) stopPolling(activeController.current);
          setPhase('done');
          return;
        }
        if (progress?.result === 'requirements') {
          if (activeController.current) stopPolling(activeController.current);
          setPhase('requirements');
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
          if (openWhenReady) router.push(`/learn/class/${progress.classId}`);
          else {
            setPhase('idle');
            router.refresh();
          }
          return;
        }
      } catch (err) {
        if (isAbortError(err)) return;
        if (signal.aborted) return;
        activeController.current?.abort();
        activeController.current = null;
        setStatusUnavailable(true);
        setPhase('idle');
        return;
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
      {activity.failureReason && <p>{activity.failureReason}</p>}
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

  if (phase === 'requirements') {
    return (
      <div className={styles.root}>
        <p className={styles.done} role="status">
          Sequential lessons for this level are complete. Review its objectives and readiness before
          advancing.
        </p>
        <Link href={`/learn/map?course=${encodeURIComponent(courseId)}`} className={styles.button}>
          View level requirements
        </Link>
        {children}
      </div>
    );
  }
  if (phase === 'done') {
    return (
      <div className={styles.root}>
        <p className={styles.done} role="status">
          Course complete
        </p>
        {children}
      </div>
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
      <div className={styles.root}>
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
        {children}
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
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          onClick={handleContinue}
          aria-label={activeClassId ? 'Resume active class' : 'Take a class at this level'}
        >
          {buttonLabel}
        </button>
        {(statusUnavailable || (generation && generation.status !== 'IDLE')) && (
          <button
            type="button"
            className={styles.statusButton}
            onClick={() => startPolling(true, true, false)}
          >
            {statusUnavailable ? 'Retry preparation status' : 'View preparation details'}
          </button>
        )}
      </div>
      <p className={styles.preparationStatus} role="status">
        {statusUnavailable
          ? 'Could not read class preparation status.'
          : generation
            ? generation.status === 'IDLE'
              ? 'No class is being prepared.'
              : generation.operationStatus === 'QUEUED' && generation.availableAt
                ? `Scheduled for ${new Date(generation.availableAt).toLocaleString(undefined, {
                    timeZone: generation.timeZone,
                  })}.`
                : isClassReadyToOpen(generation)
                  ? 'Your class is ready.'
                  : generation.detail
            : 'Checking class preparation status...'}
      </p>
      {children}
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
