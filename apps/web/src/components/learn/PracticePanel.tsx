'use client';

import { useCallback, useEffect, useState } from 'react';
import { PracticeRunner, type PracticeStart } from './PracticeRunner';
import styles from './PracticePanel.module.css';

interface PracticePanelProps {
  courseId: string;
  courseName: string;
}

interface Overview {
  due: { vocab: number; grammar: number };
  totalVocab: number;
  recent: Array<{ id: string; kind: string; status: string; score: number | null }>;
}

type StartResponse = PracticeStart | { status: 'unavailable'; reason: string };

const KINDS: Array<{ kind: string; label: string; blurb: string }> = [
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

export function PracticePanel({ courseId, courseName }: PracticePanelProps) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [phase, setPhase] = useState<Phase>('overview');
  const [start, setStart] = useState<PracticeStart | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch(`/api/courses/${courseId}/practice`);
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

  async function startKind(kind: string) {
    setPhase('starting');
    setError('');
    setMessage('');
    try {
      const res = await fetch(`/api/courses/${courseId}/practice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const data = (await res.json()) as StartResponse;
      if (data.status === 'unavailable') {
        setMessage(UNAVAILABLE_COPY[data.reason] ?? 'Practice is not available yet for this skill.');
        setPhase('unavailable');
        return;
      }
      setStart(data);
      setPhase('running');
    } catch {
      setError('Network error. Please try again.');
      setPhase('overview');
    }
  }

  function backToOverview() {
    setStart(null);
    setPhase('overview');
    void loadOverview();
  }

  if (phase === 'running' && start) {
    return (
      <div className={styles.root}>
        <header className={styles.runHeader}>
          <button type="button" className={styles.backLink} onClick={backToOverview} aria-label="Back to practice menu">
            ← Practice menu
          </button>
        </header>
        <PracticeRunner start={start} onDone={backToOverview} />
      </div>
    );
  }

  const dueBadge: Record<string, number | undefined> = {
    VOCAB: overview?.due.vocab,
    GRAMMAR: overview?.due.grammar,
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h2 className={styles.courseName}>{courseName}</h2>
        <p className={styles.subtitle}>Quick, ungated review — separate from your graded classes.</p>
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
