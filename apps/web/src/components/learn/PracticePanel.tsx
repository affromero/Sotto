'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SottoSpinner } from '@/components/ui/SottoSpinner';
import { PracticeRunner, type PracticeStart } from './PracticeRunner';
import styles from './PracticePanel.module.css';
import type { PracticePreparing } from '@sotto/shared';

interface PracticePanelProps {
  courseId: string;
  courseName: string;
  initialFocusTargetId?: string | null;
  initialAutoMode?: string | null;
  initialKind?: string | null;
}

interface Overview {
  due: { vocab: number; grammar: number };
  totalVocab: number;
  recent: Array<{
    id: string;
    kind: string;
    status: string;
    score: number | null;
    startedAt?: string;
    completedAt?: string | null;
  }>;
}

type StartResponse = PracticeStart | PracticePreparing | { status: 'unavailable'; reason: string };

const KINDS: Array<{ kind: string; label: string; blurb: string }> = [
  { kind: 'FULL', label: 'Full catch-up', blurb: 'Mixed review across weak spots' },
  { kind: 'VOCAB', label: 'Vocabulary', blurb: 'Recall words from memory' },
  { kind: 'GRAMMAR', label: 'Grammar', blurb: 'Fresh grammar questions' },
  { kind: 'READING', label: 'Reading', blurb: 'Short passages + comprehension' },
  { kind: 'LISTENING', label: 'Listening', blurb: 'A short adaptive audio clip' },
  { kind: 'SPEAKING', label: 'Speaking', blurb: 'Say phrases, get feedback' },
  { kind: 'WRITING', label: 'Writing', blurb: 'Write a reply, get inline corrections' },
];

const UNAVAILABLE_COPY: Record<string, string> = {
  not_enough_vocab: 'Take a class first to build up some vocabulary to review.',
  nothing_due: "You're all caught up. Nothing is due for review right now.",
  no_content: 'Take a class first to unlock practice for this skill.',
};

type Phase = 'overview' | 'starting' | 'running' | 'unavailable';

/** At or above this, the session counts as passed rather than merely finished. */
const PASS_SCORE = 0.7;

type SessionState = { label: string; tone: 'progress' | 'passed' | 'done' };

function sessionState(session: Overview['recent'][number]): SessionState {
  if (session.status === 'ACTIVE') return { label: 'In progress', tone: 'progress' };
  if (session.status === 'GENERATING') return { label: 'Preparing', tone: 'progress' };
  if (session.status === 'FAILED') return { label: 'Generation failed', tone: 'done' };
  if (session.status === 'CANCELLED') return { label: 'Cancelled', tone: 'done' };
  if ((session.score ?? 0) >= PASS_SCORE) return { label: 'Passed', tone: 'passed' };
  return { label: 'Done', tone: 'done' };
}

export function PracticePanel({
  courseId,
  courseName,
  initialFocusTargetId = null,
  initialAutoMode = null,
  initialKind = null,
}: PracticePanelProps) {
  const autoStarted = useRef(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [phase, setPhase] = useState<Phase>('overview');
  const [start, setStart] = useState<PracticeStart | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [selectedKind, setSelectedKind] = useState<string | null>(null);
  const [preparation, setPreparation] = useState<PracticePreparing | null>(null);
  const pendingSessionId = useRef<string | null>(null);
  const startController = useRef<AbortController | null>(null);

  const acceptPreparation = useCallback((value: PracticePreparing) => {
    pendingSessionId.current = value.sessionId;
    setPreparation(value);
    if (['FAILED', 'CANCELLED'].includes(value.preparationStatus)) {
      setMessage(value.message);
      setPhase('unavailable');
    } else {
      setPhase('starting');
    }
  }, []);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/courses/${courseId}/practice`);
      if (res.ok) setOverview((await res.json()) as Overview);
    } catch {
      /* non-fatal. The picker still works */
    }
  }, [courseId]);

  useEffect(() => {
    void (async () => {
      await loadOverview();
    })();
  }, [loadOverview]);

  const startKind = useCallback(
    async (kind: string, focusTargetId?: string | null) => {
      setPhase('starting');
      setSelectedKind(kind);
      setError('');
      setMessage('');
      setPreparation(null);
      const controller = new AbortController();
      startController.current = controller;
      const requestId = crypto.randomUUID();
      pendingSessionId.current = requestId;
      try {
        const res = await fetch(`/api/v1/courses/${courseId}/practice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, requestId, ...(focusTargetId ? { focusTargetId } : {}) }),
          signal: controller.signal,
        });
        const data = (await res.json()) as StartResponse;
        if (!res.ok) {
          setError(readPracticeError(data));
          setPhase('overview');
          return;
        }
        if (data.status === 'unavailable') {
          setMessage(
            UNAVAILABLE_COPY[data.reason] ?? 'Practice is not available yet for this skill.'
          );
          setPhase('unavailable');
          return;
        }
        if (data.status === 'preparing') {
          acceptPreparation(data);
          return;
        }
        setStart(data);
        setPhase('running');
      } catch (err) {
        // An abort is the learner cancelling; cancelPractice already reset the
        // panel, so there is nothing to report.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError('The request acknowledgement was lost. Check whether this attempt was saved.');
      } finally {
        if (startController.current === controller) startController.current = null;
      }
    },
    [courseId, acceptPreparation]
  );

  const [deletingId, setDeletingId] = useState<string | null>(null);

  /// Discarding a session the learner does not intend to finish. The row goes
  /// immediately; a failure puts it back by reloading the overview.
  const deleteSession = useCallback(
    async (sessionId: string, label: string) => {
      if (!window.confirm(`Delete this ${label} session? Its answers and recordings go with it.`)) {
        return;
      }

      setDeletingId(sessionId);
      setError('');
      try {
        const res = await fetch(`/api/v1/practice/${sessionId}`, { method: 'DELETE' });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? 'Could not delete that session. Please try again.');
        }
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setDeletingId(null);
        void loadOverview();
      }
    },
    [loadOverview]
  );

  const resumeSession = useCallback(
    async (sessionId: string) => {
      setError('');
      setMessage('');
      try {
        const res = await fetch(`/api/v1/practice/${sessionId}`);
        if (!res.ok) {
          setError('That session could not be reopened. Start a new one.');
          void loadOverview();
          return;
        }
        const data = (await res.json()) as StartResponse;
        if (data.status === 'preparing') {
          acceptPreparation(data);
          return;
        }
        if (data.status === 'unavailable') {
          setMessage(UNAVAILABLE_COPY[data.reason] ?? 'Practice is unavailable.');
          setPhase('unavailable');
          return;
        }
        setStart(data);
        setPhase('running');
      } catch {
        setError('Network error. Please try again.');
      }
    },
    [loadOverview, acceptPreparation]
  );

  const cancelPractice = useCallback(
    async (recover = false) => {
      const sessionId = pendingSessionId.current;
      if (
        recover &&
        !window.confirm(
          'An interrupted provider request may have incurred charges. Recover this attempt after execution cleanup is confirmed?'
        )
      )
        return;
      startController.current?.abort();
      startController.current = null;
      if (!sessionId) {
        setPhase('overview');
        return;
      }
      try {
        const response = await fetch(`/api/v1/practice/${sessionId}/generation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: recover ? 'recover' : 'cancel',
            ...(recover ? { acknowledgeUnknownOutcome: true } : {}),
          }),
        });
        const result = await response.json();
        if (!response.ok) {
          setError(result.error ?? 'Could not cancel practice generation.');
          return;
        }
        acceptPreparation(result as PracticePreparing);
      } catch {
        setError('Could not confirm cancellation. Reopen this saved attempt to check its status.');
      }
    },
    [acceptPreparation]
  );

  const checkPreparation = useCallback(
    async (isActive: () => boolean = () => true) => {
      const sessionId = pendingSessionId.current;
      if (!sessionId) return;
      try {
        const response = await fetch(`/api/v1/practice/${sessionId}`);
        const data = (await response.json()) as StartResponse & { error?: string };
        if (!isActive()) return;
        if (!response.ok) {
          setError(data.error ?? 'Could not check saved practice generation.');
          return;
        }
        setError('');
        if (data.status === 'preparing') {
          acceptPreparation(data);
          return;
        }
        if (data.status === 'unavailable') {
          setMessage(UNAVAILABLE_COPY[data.reason] ?? 'Practice is unavailable.');
          setPhase('unavailable');
          return;
        }
        setPreparation(null);
        setStart(data);
        setPhase('running');
      } catch {
        if (isActive())
          setError(
            'Could not check generation. Reopen the saved attempt or check its status again.'
          );
      }
    },
    [acceptPreparation]
  );

  useEffect(() => {
    if (phase !== 'starting' || !preparation) return;
    if (preparation.preparationStatus === 'UNRESOLVED') return;
    let active = true;
    const timer = window.setTimeout(() => void checkPreparation(() => active), 1500);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [phase, preparation, checkPreparation]);

  useEffect(() => {
    if (!initialFocusTargetId || autoStarted.current) return;
    autoStarted.current = true;
    const kind = initialAutoMode === 'sentences' ? 'READING' : 'FULL';
    const timer = window.setTimeout(() => {
      void startKind(kind, initialFocusTargetId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialAutoMode, initialFocusTargetId, startKind]);

  useEffect(() => {
    if (!initialKind || initialFocusTargetId || autoStarted.current) return;
    const normalizedKind = initialKind.toUpperCase();
    if (!KINDS.some((item) => item.kind === normalizedKind)) return;
    autoStarted.current = true;
    const timer = window.setTimeout(() => {
      void startKind(normalizedKind);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialFocusTargetId, initialKind, startKind]);

  function backToOverview() {
    setStart(null);
    setPhase('overview');
    void loadOverview();
  }

  if (phase === 'running' && start) {
    return (
      <div className={styles.root}>
        <header className={styles.runHeader}>
          <button
            type="button"
            className={styles.backLink}
            onClick={backToOverview}
            aria-label="Back to practice menu"
          >
            ← Practice menu
          </button>
        </header>
        <PracticeRunner courseId={courseId} start={start} onDone={backToOverview} />
      </div>
    );
  }

  const dueBadge: Record<string, number | undefined> = {
    FULL: overview ? overview.due.vocab + overview.due.grammar : undefined,
    VOCAB: overview?.due.vocab,
    GRAMMAR: overview?.due.grammar,
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h2 className={styles.courseName}>{courseName}</h2>
        <p className={styles.subtitle}>Quick, ungated review. Separate from your graded classes.</p>
      </header>

      {phase === 'starting' && (
        <div className={styles.startingPanel} role="status" aria-live="polite">
          <SottoSpinner size="medium" ariaLabel="Building practice" />
          <div>
            <p className={styles.startingTitle}>Building {kindLabel(selectedKind)} practice</p>
            <p className={styles.startingText}>
              {preparation?.message ?? 'Saving your practice request.'}
            </p>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => void cancelPractice(preparation?.preparationStatus === 'UNRESOLVED')}
            >
              {preparation?.preparationStatus === 'UNRESOLVED'
                ? 'Recover interrupted attempt'
                : 'Cancel generation'}
            </button>
            {error && (
              <button
                type="button"
                className={styles.cancelButton}
                onClick={() => void checkPreparation()}
              >
                Check saved status
              </button>
            )}
            <button type="button" className={styles.linkButton} onClick={backToOverview}>
              Practice menu
            </button>
          </div>
        </div>
      )}

      {phase === 'unavailable' && (
        <p className={styles.notice} role="status">
          {message}{' '}
          <button type="button" className={styles.linkButton} onClick={() => setPhase('overview')}>
            Pick another
          </button>
        </p>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <ul className={styles.kindList} role="list">
        {KINDS.map(({ kind, label, blurb }) => {
          const due = dueBadge[kind];
          return (
            <li key={kind}>
              <button
                type="button"
                className={styles.kindCard}
                onClick={() => void startKind(kind)}
                disabled={phase === 'starting'}
                aria-busy={phase === 'starting'}
                aria-label={`Practice ${label}${due ? `, ${due} due` : ''}`}
              >
                <span className={styles.kindLabel}>{label}</span>
                <span className={styles.kindBlurb}>{blurb}</span>
                {due !== undefined && due > 0 && (
                  <span className={styles.dueBadge} aria-hidden="true">
                    {due} due
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {overview && overview.recent.length > 0 && (
        <section className={styles.recent} aria-labelledby="recent-practice-heading">
          <h3 id="recent-practice-heading" className={styles.recentHeading}>
            Recent sessions
          </h3>
          <ul className={styles.recentList} role="list">
            {overview.recent.map((session) => {
              const state = sessionState(session);
              const label = kindLabel(session.kind);
              const completed = session.status === 'COMPLETED';
              return (
                <li key={session.id} className={styles.recentRow}>
                  <span className={styles.recentKind}>{label}</span>
                  <span className={`${styles.badge} ${styles[state.tone]}`}>{state.label}</span>
                  {session.score !== null && (
                    <span className={styles.recentScore}>{Math.round(session.score * 100)}%</span>
                  )}
                  {
                    <button
                      type="button"
                      className={styles.resumeButton}
                      onClick={() => void resumeSession(session.id)}
                      disabled={phase === 'starting' || deletingId === session.id}
                      aria-label={`${completed ? 'View results for' : 'Resume'} ${label} practice`}
                    >
                      {completed ? 'View results' : 'Resume'}
                    </button>
                  }
                  <button
                    type="button"
                    className={styles.deleteButton}
                    onClick={() => void deleteSession(session.id, label)}
                    disabled={deletingId === session.id}
                    aria-label={`Delete ${label} session`}
                  >
                    {deletingId === session.id ? 'Deleting…' : 'Delete'}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function kindLabel(kind: string | null): string {
  return KINDS.find((item) => item.kind === kind)?.label ?? 'your';
}

function readPracticeError(data: StartResponse | { error?: unknown }): string {
  if ('error' in data && typeof data.error === 'string') return data.error;
  return 'Could not start practice. Try again.';
}
