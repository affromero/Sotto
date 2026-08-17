'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SottoSpinner } from '@/components/ui/SottoSpinner';
import { PracticeRunner, type PracticeStart } from './PracticeRunner';
import styles from './PracticePanel.module.css';

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
  nothing_due: "You're all caught up. Nothing is due for review right now.",
  no_content: 'Take a class first to unlock practice for this skill.',
};

type Phase = 'overview' | 'starting' | 'running' | 'unavailable';

/**
 * Estimated build progress. The start POST is a single blocking request with
 * no server-side progress signal, so this eases asymptotically toward 95%
 * (tau ~40s, matching typical script + audio build times) and only ever hits
 * 100 when the response lands.
 */
function useEstimatedProgress(active: boolean): number {
  const [percent, setPercent] = useState(0);
  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      setPercent(Math.round(95 * (1 - Math.exp(-elapsed / 40))));
    }, 500);
    return () => {
      window.clearInterval(timer);
      setPercent(0);
    };
  }, [active]);
  return percent;
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
  const buildPercent = useEstimatedProgress(phase === 'starting');

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
      try {
        const res = await fetch(`/api/v1/courses/${courseId}/practice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, ...(focusTargetId ? { focusTargetId } : {}) }),
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
              Sotto is preparing the questions and any audio or prompts this session needs.
            </p>
            <div className={styles.progressRow}>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-valuenow={buildPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Estimated build progress"
              >
                <div className={styles.progressFill} style={{ width: `${buildPercent}%` }} />
              </div>
              <span className={styles.progressLabel}>~{buildPercent}%</span>
            </div>
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
