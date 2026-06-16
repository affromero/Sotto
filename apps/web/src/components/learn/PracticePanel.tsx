'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PracticeRunner, type PracticeStart } from './PracticeRunner';
import styles from './PracticePanel.module.css';

interface PracticePanelProps {
  courseId: string;
  courseName: string;
  initialFocusTargetId?: string | null;
  initialAutoMode?: string | null;
}

interface Overview {
  due: { vocab: number; grammar: number };
  totalVocab: number;
  recent: Array<{ id: string; kind: string; status: string; score: number | null }>;
}

type StartResponse = PracticeStart | { status: 'unavailable'; reason: string };

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
  nothing_due: "You're all caught up — nothing is due for review right now.",
  no_content: 'Take a class first to unlock practice for this skill.',
};

type Phase = 'overview' | 'starting' | 'running' | 'unavailable';

export function PracticePanel({
  courseId,
  courseName,
  initialFocusTargetId = null,
  initialAutoMode = null,
}: PracticePanelProps) {
  const autoStarted = useRef(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [phase, setPhase] = useState<Phase>('overview');
  const [start, setStart] = useState<PracticeStart | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/courses/${courseId}/practice`);
      if (res.ok) setOverview((await res.json()) as Overview);
    } catch {
      /* non-fatal — the picker still works */
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
      setError('');
      setMessage('');
      try {
        const res = await fetch(`/api/v1/courses/${courseId}/practice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, ...(focusTargetId ? { focusTargetId } : {}) }),
        });
        const data = (await res.json()) as StartResponse;
        if (data.status === 'unavailable') {
          setMessage(
            UNAVAILABLE_COPY[data.reason] ?? 'Practice is not available yet for this skill.'
          );
          setPhase('unavailable');
          return;
        }
        setStart(data);
        setPhase('running');
      } catch {
        setError('Network error. Please try again.');
        setPhase('overview');
      }
    },
    [courseId]
  );

  useEffect(() => {
    if (!initialFocusTargetId || autoStarted.current) return;
    autoStarted.current = true;
    const kind = initialAutoMode === 'sentences' ? 'READING' : 'FULL';
    const timer = window.setTimeout(() => {
      void startKind(kind, initialFocusTargetId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialAutoMode, initialFocusTargetId, startKind]);

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
        <p className={styles.subtitle}>
          Quick, ungated review — separate from your graded classes.
        </p>
      </header>

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
                aria-label={`Practice ${label}${due ? ` — ${due} due` : ''}`}
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
    </div>
  );
}
