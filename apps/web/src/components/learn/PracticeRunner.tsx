'use client';

import { useCallback, useEffect, useState } from 'react';
import { SpeakingExercise } from '@/components/class/SpeakingExercise';
import { ScoreDial } from './ClassWidgets';
import { WritingSection } from './WritingSection';
import type { WritingPromptData } from './classTypes';
import styles from './PracticeRunner.module.css';

// ---- Types (mirror the practice API) ----

export interface PracticeMcItem {
  id: string;
  prompt: string;
  options: string[];
}

export interface PracticeSpeakingItem {
  id: string;
  targetPhrase: string;
  translation: string;
  referenceTtsUrl?: string | null;
}

export interface PracticeWritingItem {
  id: string;
  task: string;
  guidance?: string | null;
}

export type PracticeStart =
  | { status: 'ready'; sessionId: string; kind: string; items: PracticeMcItem[]; podcastId?: string }
  | { status: 'ready_speaking'; sessionId: string; prompts: PracticeSpeakingItem[] }
  | { status: 'ready_writing'; sessionId: string; prompts: PracticeWritingItem[] };

interface SubmitResult {
  score: number;
  correct: number;
  total: number;
}

interface PracticeRunnerProps {
  start: PracticeStart;
  onDone: () => void;
}


// ---- Listening audio: poll the podcast until its audio is ready ----

function ListeningAudio({ podcastId }: { podcastId: string }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function poll() {
      try {
        const res = await fetch(`/api/podcasts/${podcastId}`);
        if (res.ok) {
          const data = (await res.json()) as { audioUrl?: string | null };
          if (active && data.audioUrl) {
            setAudioUrl(data.audioUrl);
            return;
          }
        }
      } catch {
        /* retry below */
      }
      if (active) timer = setTimeout(() => void poll(), 3000);
    }
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [podcastId]);

  if (!audioUrl) {
    return (
      <p className={styles.audioGenerating} role="status">
        Audio is generating — the questions below are ready while you wait.
      </p>
    );
  }
  return (
    <audio className={styles.audioPlayer} controls preload="metadata" src={audioUrl} aria-label="Practice audio" />
  );
}

// ---- MC runner (VOCAB / GRAMMAR / READING / LISTENING) ----

function McRunner({ start, onDone }: { start: Extract<PracticeStart, { status: 'ready' }>; onDone: () => void }) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [phase, setPhase] = useState<'answering' | 'submitting' | 'result' | 'error'>('answering');
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState('');

  const allAnswered = start.items.every((it) => answers[it.id] !== undefined);

  const submit = useCallback(async () => {
    setPhase('submitting');
    setError('');
    try {
      const res = await fetch(`/api/practice/${start.sessionId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: Object.entries(answers).map(([itemId, selectedIndex]) => ({ itemId, selectedIndex })),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Failed to submit. Please try again.');
        setPhase('answering');
        return;
      }
      setResult((await res.json()) as SubmitResult);
      setPhase('result');
    } catch {
      setError('Network error. Please try again.');
      setPhase('answering');
    }
  }, [answers, start.sessionId]);

  if (phase === 'result' && result) {
    return (
      <div className={styles.resultPanel} role="region" aria-label="Practice result">
        <ScoreDial value={Math.round(result.score * 100)} size={92} stroke={7} />
        <p className={styles.resultLine}>
          {result.correct} of {result.total} correct — reviewed and scheduled for spaced repetition.
        </p>
        <button type="button" className={styles.primaryButton} onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className={styles.runner}>
      {start.podcastId && (
        <div className={styles.audioBlock}>
          <ListeningAudio podcastId={start.podcastId} />
        </div>
      )}

      <ol className={styles.questionList}>
        {start.items.map((it, qi) => {
          const selected = answers[it.id];
          return (
            <li key={it.id} className={styles.question}>
              <div className={styles.drillCard}>
                <div className={styles.drillMeta}>
                  <span className={styles.drillIdx}>
                    {qi + 1} of {start.items.length}
                  </span>
                </div>
                <p className={styles.questionText}>{it.prompt}</p>
                <div className={styles.options} role="group" aria-label={`Options for: ${it.prompt}`}>
                  {it.options.map((opt, idx) => {
                    const isSelected = selected === idx;
                    return (
                      <button
                        key={idx}
                        type="button"
                        className={`${styles.option} ${isSelected ? styles.optionSelected : ''}`}
                        onClick={() => setAnswers((prev) => ({ ...prev, [it.id]: idx }))}
                        aria-pressed={isSelected}
                        aria-label={`Option ${idx + 1}: ${opt}`}
                      >
                        <span className={styles.optionLetter} aria-hidden="true">
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <span className={styles.optionText}>{opt}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {error && (
        <p className={styles.errorBanner} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        <p className={styles.progressHint} aria-live="polite">
          {Object.keys(answers).length} of {start.items.length} answered
        </p>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => void submit()}
          disabled={!allAnswered || phase === 'submitting'}
          aria-disabled={!allAnswered || phase === 'submitting'}
          aria-busy={phase === 'submitting'}
        >
          {phase === 'submitting' ? 'Grading…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}

// ---- Speaking runner ----

function SpeakingRunner({
  start,
  onDone,
}: {
  start: Extract<PracticeStart, { status: 'ready_speaking' }>;
  onDone: () => void;
}) {
  const [finishing, setFinishing] = useState(false);

  async function finish() {
    setFinishing(true);
    // Apply SRS from whatever recordings have been graded so far.
    await fetch(`/api/practice/${start.sessionId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [] }),
    }).catch(() => {});
    onDone();
  }

  return (
    <div className={styles.runner}>
      <SpeakingExercise endpointBase={`/api/practice/${start.sessionId}/speaking`} prompts={start.prompts} />
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => void finish()}
          disabled={finishing}
          aria-busy={finishing}
        >
          {finishing ? 'Finishing…' : 'Finish practice'}
        </button>
      </div>
    </div>
  );
}

// ---- Writing runner ----

function WritingRunner({
  start,
  onDone,
}: {
  start: Extract<PracticeStart, { status: 'ready_writing' }>;
  onDone: () => void;
}) {
  const [finishing, setFinishing] = useState(false);

  const prompts: WritingPromptData[] = start.prompts.map((p, idx) => ({
    id: p.id,
    order: idx,
    task: p.task,
    guidance: p.guidance ?? null,
    response: null,
  }));

  async function finish() {
    setFinishing(true);
    // Apply SRS from whatever responses have been graded so far.
    await fetch(`/api/practice/${start.sessionId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [] }),
    }).catch(() => {});
    onDone();
  }

  return (
    <div className={styles.runner}>
      <WritingSection endpointBase={`/api/practice/${start.sessionId}/writing`} prompts={prompts} />
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => void finish()}
          disabled={finishing}
          aria-busy={finishing}
        >
          {finishing ? 'Finishing…' : 'Finish practice'}
        </button>
      </div>
    </div>
  );
}

export function PracticeRunner({ start, onDone }: PracticeRunnerProps) {
  if (start.status === 'ready_speaking') {
    return <SpeakingRunner start={start} onDone={onDone} />;
  }
  if (start.status === 'ready_writing') {
    return <WritingRunner start={start} onDone={onDone} />;
  }
  return <McRunner start={start} onDone={onDone} />;
}
