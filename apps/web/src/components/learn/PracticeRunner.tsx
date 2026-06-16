'use client';

import { useCallback, useEffect, useState } from 'react';
import { SpeakingExercise } from '@/components/class/SpeakingExercise';
import guardStyles from '@/components/ui/LearningTextGuard.module.css';
import { learningTextGuardProps } from '@/components/ui/learningTextGuard';
import { ScoreDial } from './ClassWidgets';
import { LearningSelectionMenu } from './LearningSelectionMenu';
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
  | {
      status: 'ready';
      sessionId: string;
      kind: string;
      items: PracticeMcItem[];
      episodeId?: string;
    }
  | { status: 'ready_speaking'; sessionId: string; prompts: PracticeSpeakingItem[] }
  | { status: 'ready_writing'; sessionId: string; prompts: PracticeWritingItem[] }
  | {
      status: 'ready_full';
      sessionId: string;
      kind: 'FULL';
      items: PracticeMcItem[];
      episodeId?: string;
      speakingPrompts: PracticeSpeakingItem[];
      writingPrompts: PracticeWritingItem[];
    };

interface SubmitResult {
  score: number;
  correct: number;
  total: number;
}

interface PracticeRunnerProps {
  courseId: string;
  start: PracticeStart;
  onDone: () => void;
}

// ---- Listening audio: poll the episode until its audio is ready ----

function ListeningAudio({ episodeId }: { episodeId: string }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function poll() {
      try {
        const res = await fetch(`/api/v1/episodes/${episodeId}`);
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
  }, [episodeId]);

  if (!audioUrl) {
    return (
      <p className={styles.audioGenerating} role="status">
        Audio is generating. The questions below are ready while you wait.
      </p>
    );
  }
  return (
    <audio
      className={styles.audioPlayer}
      controls
      preload="metadata"
      src={audioUrl}
      aria-label="Practice audio"
    />
  );
}

function ResultPanel({ result, onDone }: { result: SubmitResult; onDone: () => void }) {
  return (
    <div className={styles.resultPanel} role="region" aria-label="Practice result">
      <ScoreDial value={Math.round(result.score * 100)} size={92} stroke={7} />
      <p className={styles.resultLine}>
        {result.correct} of {result.total} correct, reviewed and scheduled for spaced repetition.
      </p>
      <button type="button" className={styles.primaryButton} onClick={onDone}>
        Done
      </button>
    </div>
  );
}

function MultipleChoiceList({
  courseId,
  sessionId,
  items,
  answers,
  onAnswer,
}: {
  courseId: string;
  sessionId: string;
  items: PracticeMcItem[];
  answers: Record<string, number>;
  onAnswer: (itemId: string, selectedIndex: number) => void;
}) {
  return (
    <ol className={styles.questionList}>
      {items.map((it, qi) => {
        const selected = answers[it.id];
        return (
          <li key={it.id} className={styles.question}>
            <div className={styles.drillCard}>
              <div className={styles.drillMeta}>
                <span className={styles.drillIdx}>
                  {qi + 1} of {items.length}
                </span>
              </div>
              <LearningSelectionMenu
                courseId={courseId}
                sourceType="PRACTICE"
                sourceId={sessionId}
                sourceLabel="Practice"
              >
                <p
                  className={`${styles.questionText} ${guardStyles.guarded}`}
                  {...learningTextGuardProps<HTMLParagraphElement>()}
                >
                  {it.prompt}
                </p>
              </LearningSelectionMenu>
              <div className={styles.options} role="group" aria-label={`Options for: ${it.prompt}`}>
                {it.options.map((opt, idx) => {
                  const isSelected = selected === idx;
                  return (
                    <LearningSelectionMenu
                      key={idx}
                      courseId={courseId}
                      sourceType="PRACTICE"
                      sourceId={sessionId}
                      sourceLabel="Practice"
                    >
                      <button
                        type="button"
                        className={`${styles.option} ${isSelected ? styles.optionSelected : ''} ${guardStyles.guarded}`}
                        {...learningTextGuardProps<HTMLButtonElement>()}
                        onClick={() => onAnswer(it.id, idx)}
                        aria-pressed={isSelected}
                        aria-label={`Option ${idx + 1}: ${opt}`}
                      >
                        <span className={styles.optionLetter} aria-hidden="true">
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <span className={styles.optionText}>{opt}</span>
                      </button>
                    </LearningSelectionMenu>
                  );
                })}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---- MC runner (VOCAB / GRAMMAR / READING / LISTENING) ----

function McRunner({
  courseId,
  start,
  onDone,
}: {
  courseId: string;
  start: Extract<PracticeStart, { status: 'ready' }>;
  onDone: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [phase, setPhase] = useState<'answering' | 'submitting' | 'result' | 'error'>('answering');
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState('');

  const allAnswered = start.items.every((it) => answers[it.id] !== undefined);

  const submit = useCallback(async () => {
    setPhase('submitting');
    setError('');
    try {
      const res = await fetch(`/api/v1/practice/${start.sessionId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: Object.entries(answers).map(([itemId, selectedIndex]) => ({
            itemId,
            selectedIndex,
          })),
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
    return <ResultPanel result={result} onDone={onDone} />;
  }

  return (
    <div className={styles.runner}>
      {start.episodeId && (
        <div className={styles.audioBlock}>
          <ListeningAudio episodeId={start.episodeId} />
        </div>
      )}

      <MultipleChoiceList
        courseId={courseId}
        sessionId={start.sessionId}
        items={start.items}
        answers={answers}
        onAnswer={(itemId, selectedIndex) =>
          setAnswers((prev) => ({ ...prev, [itemId]: selectedIndex }))
        }
      />

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
    await fetch(`/api/v1/practice/${start.sessionId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [] }),
    }).catch(() => {});
    onDone();
  }

  return (
    <div className={styles.runner}>
      <SpeakingExercise
        endpointBase={`/api/v1/practice/${start.sessionId}/speaking`}
        prompts={start.prompts}
      />
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
    await fetch(`/api/v1/practice/${start.sessionId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [] }),
    }).catch(() => {});
    onDone();
  }

  return (
    <div className={styles.runner}>
      <WritingSection
        endpointBase={`/api/v1/practice/${start.sessionId}/writing`}
        prompts={prompts}
      />
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

function FullRunner({
  courseId,
  start,
  onDone,
}: {
  courseId: string;
  start: Extract<PracticeStart, { status: 'ready_full' }>;
  onDone: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [phase, setPhase] = useState<'answering' | 'submitting' | 'result' | 'error'>('answering');
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState('');

  const allAnswered = start.items.every((it) => answers[it.id] !== undefined);
  const writingPrompts: WritingPromptData[] = start.writingPrompts.map((p, idx) => ({
    id: p.id,
    order: idx,
    task: p.task,
    guidance: p.guidance ?? null,
    response: null,
  }));

  const submit = useCallback(async () => {
    setPhase('submitting');
    setError('');
    try {
      const res = await fetch(`/api/v1/practice/${start.sessionId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: Object.entries(answers).map(([itemId, selectedIndex]) => ({
            itemId,
            selectedIndex,
          })),
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
    return <ResultPanel result={result} onDone={onDone} />;
  }

  return (
    <div className={styles.runner}>
      {start.episodeId && (
        <div className={styles.audioBlock}>
          <ListeningAudio episodeId={start.episodeId} />
        </div>
      )}

      {start.items.length > 0 && (
        <MultipleChoiceList
          courseId={courseId}
          sessionId={start.sessionId}
          items={start.items}
          answers={answers}
          onAnswer={(itemId, selectedIndex) =>
            setAnswers((prev) => ({ ...prev, [itemId]: selectedIndex }))
          }
        />
      )}

      {start.speakingPrompts.length > 0 && (
        <section className={styles.fullSection} aria-label="Speaking">
          <SpeakingExercise
            endpointBase={`/api/v1/practice/${start.sessionId}/speaking`}
            prompts={start.speakingPrompts}
          />
        </section>
      )}

      {writingPrompts.length > 0 && (
        <section className={styles.fullSection} aria-label="Writing">
          <WritingSection
            endpointBase={`/api/v1/practice/${start.sessionId}/writing`}
            prompts={writingPrompts}
          />
        </section>
      )}

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
          {phase === 'submitting' ? 'Finishing…' : 'Finish practice'}
        </button>
      </div>
    </div>
  );
}

export function PracticeRunner({ courseId, start, onDone }: PracticeRunnerProps) {
  if (start.status === 'ready_full') {
    return <FullRunner courseId={courseId} start={start} onDone={onDone} />;
  }
  if (start.status === 'ready_speaking') {
    return <SpeakingRunner start={start} onDone={onDone} />;
  }
  if (start.status === 'ready_writing') {
    return <WritingRunner start={start} onDone={onDone} />;
  }
  return <McRunner courseId={courseId} start={start} onDone={onDone} />;
}
