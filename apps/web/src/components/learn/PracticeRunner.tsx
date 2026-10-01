'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { SpeakingExercise } from '@/components/class/SpeakingExercise';
import guardStyles from '@/components/ui/LearningTextGuard.module.css';
import { learningTextGuardProps } from '@/components/ui/learningTextGuard';
import { ScoreDial } from './ClassWidgets';
import { LearningSelectionMenu } from './LearningSelectionMenu';
import { WritingSection } from './WritingSection';
import { useWritingDrafts } from './writing/useWritingDrafts';
import type { WritingPromptData } from './classTypes';
import styles from './PracticeRunner.module.css';
import type {
  SkillRequirements,
  PracticeReceipt,
  SpeakingEvidence,
  WritingFeedback,
} from '@sotto/shared';
import { practiceReceiptSchema } from '@sotto/shared';
import { LearningSaveRecovery } from './progress/LearningSaveRecovery';
import { retainedLearningProgress, useLearningProgress } from './progress/useLearningProgress';

// ---- Types (mirror the practice API) ----

interface PracticeMcItem {
  id: string;
  prompt: string;
  options: string[];
  passageText?: string;
}

interface PracticeSpeakingItem {
  id: string;
  targetPhrase: string;
  translation: string;
  referenceTtsUrl?: string | null;
  latestRecording?: SpeakingEvidence | null;
}

interface PracticeWritingItem {
  id: string;
  task: string;
  guidance?: string | null;
  ideas?: string[];
  response?: WritingFeedback | null;
  savedDraft?: string;
}

type PracticeStartContent =
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

export type PracticeStart = PracticeStartContent & {
  progressRevision?: number;
  writingDrafts?: Record<string, string>;
  skillRequirements?: SkillRequirements;
  learnerAnswers?: Record<string, number>;
  submissionResult?: SubmitResult | null;
};

type SubmitResult = PracticeReceipt;

interface PracticeRunnerProps {
  courseId: string;
  start: PracticeStart;
  onDone: () => void;
}

// ---- Listening audio: poll the episode until its audio is ready ----

function ListeningAudio({
  episodeId,
  onStatusChange,
}: {
  episodeId: string;
  onStatusChange?: (status: string) => void;
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    onStatusChange?.(error ? 'Audio unavailable' : audioUrl ? 'Audio ready' : 'Audio generating');
  }, [error, audioUrl, onStatusChange]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function poll() {
      try {
        const res = await fetch(`/api/v1/episodes/${episodeId}`);
        if (!res.ok) throw new Error('Could not load listening audio.');
        const data = (await res.json()) as { audioUrl?: string | null; status?: string };
        if (!active) return;
        if (data.status === 'FAILED') {
          setError(
            'Listening audio generation failed. Start a new listening practice or check again.'
          );
          return;
        }
        if (data.audioUrl) {
          setAudioUrl(data.audioUrl);
          return;
        }
        if (data.status === 'READY') {
          setError('Listening audio is unavailable for this session.');
          return;
        }
      } catch {
        if (active)
          setError('Could not load listening audio. Check your connection and try again.');
        return;
      }
      if (active) timer = setTimeout(() => void poll(), 3000);
    }
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [episodeId, attempt]);

  if (error) {
    return (
      <div className={styles.audioBlock}>
        <p className={styles.errorBanner} role="alert">
          {error}
        </p>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => {
            setError('');
            setAudioUrl(null);
            setAttempt((value) => value + 1);
          }}
        >
          Check audio again
        </button>
      </div>
    );
  }

  if (!audioUrl) {
    return (
      <p className={styles.audioGenerating} role="status">
        Listening audio is generating. You can work on another section while you wait.
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
      onError={() => setError('Listening audio could not be played. Try loading it again.')}
    />
  );
}

function ResultPanel({ result, onDone }: { result: SubmitResult; onDone: () => void }) {
  return (
    <div className={styles.resultPanel} role="region" aria-label="Practice result">
      <ScoreDial value={Math.round(result.score * 100)} size={92} stroke={7} />
      <p className={styles.resultLine}>
        {result.correct} of {result.answered ?? result.total} choices correct.
        {result.graded ? ` ${result.graded} speaking and writing exercises graded.` : ''}
      </p>
      {result.itemFeedback && (
        <ol className={styles.questionList}>
          {result.itemFeedback.map((item) => (
            <li key={item.itemId} className={styles.question}>
              <p>{item.prompt}</p>
              <p>
                Your answer: {item.selectedAnswer}.{' '}
                {item.correct ? 'Correct.' : `Correct answer: ${item.correctAnswer}.`}
              </p>
              <p>{item.explanation}</p>
            </li>
          ))}
        </ol>
      )}
      {result.writingFeedback?.map(({ promptId, task, grade }) => (
        <article key={promptId} className={styles.question}>
          <p>{task}</p>
          <p>{grade.text}</p>
          <p>Writing score: {Math.round(grade.overallScore * 100)}%</p>
          {grade.corrections.map((correction, index) => (
            <p key={index}>
              {correction.old} → {correction.new}. {correction.why}
            </p>
          ))}
          <p>{grade.feedback}</p>
        </article>
      ))}
      {result.speakingFeedback?.map(({ promptId, targetPhrase, evidence }) => (
        <article key={promptId} className={styles.question}>
          <p>{targetPhrase}</p>
          <p>{evidence.transcript}</p>
          <p>Speaking score: {Math.round((evidence.overallScore ?? 0) * 100)}%</p>
          <p>{evidence.feedback}</p>
        </article>
      ))}
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
  const [index, setIndex] = useState(0);
  const it = items[index];
  if (!it) return null;
  return (
    <div className={styles.runner}>
      <ol className={styles.questionList}>
        {[it].map((it) => {
          const selected = answers[it.id];
          return (
            <li key={it.id} className={styles.question}>
              <div className={styles.drillCard}>
                <div className={styles.drillMeta}>
                  <span className={styles.drillIdx}>
                    {index + 1} of {items.length}
                  </span>
                </div>
                <LearningSelectionMenu
                  courseId={courseId}
                  sourceType="PRACTICE"
                  sourceId={sessionId}
                  sourceLabel="Practice"
                >
                  {it.passageText && <p className={styles.passage}>{it.passageText}</p>}
                  <p
                    className={`${styles.questionText} ${guardStyles.guarded}`}
                    {...learningTextGuardProps<HTMLParagraphElement>()}
                  >
                    {it.prompt}
                  </p>
                </LearningSelectionMenu>
                <div
                  className={styles.options}
                  role="group"
                  aria-label={`Options for: ${it.prompt}`}
                >
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
      <nav className={styles.actions} aria-label="Question navigation">
        <button
          type="button"
          className={styles.primaryButton}
          disabled={index === 0}
          onClick={() => setIndex((value) => value - 1)}
        >
          Previous question
        </button>
        <span className={styles.progressHint} aria-live="polite">
          Question {index + 1} of {items.length}
        </span>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={index === items.length - 1}
          onClick={() => setIndex((value) => value + 1)}
        >
          Next question
        </button>
      </nav>
    </div>
  );
}

function PracticeSection({
  title,
  progress,
  children,
}: {
  title: string;
  progress?: string;
  children: ReactNode;
}) {
  return (
    <details className={styles.fullSection}>
      <summary className={styles.sectionSummary}>
        {title}
        {progress && <span>{progress}</span>}
      </summary>
      <div className={styles.sectionBody}>{children}</div>
    </details>
  );
}

const MC_SECTIONS = [
  { prefix: 'f', title: 'Focused review' },
  { prefix: 'v', title: 'Vocabulary in context' },
  { prefix: 'g', title: 'Grammar' },
  { prefix: 'r', title: 'Reading' },
  { prefix: 'l', title: 'Listening' },
] as const;

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
  const [answers, setAnswers] = useState<Record<string, number>>(
    () =>
      retainedLearningProgress(
        `/api/v1/practice/${start.sessionId}`,
        { answers: start.learnerAnswers ?? {} },
        start.progressRevision ?? 0
      ).answers ?? {}
  );
  const [phase, setPhase] = useState<'answering' | 'submitting' | 'result' | 'error'>('answering');
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState('');
  const saveError = useLearningProgress(
    `/api/v1/practice/${start.sessionId}`,
    { answers },
    phase === 'answering',
    start.progressRevision ?? 0
  );

  const submit = useCallback(async () => {
    setPhase('submitting');
    setError('');

    const payload = Object.entries(answers).map(([itemId, selectedIndex]) => ({
      itemId,
      selectedIndex,
    }));

    try {
      const res = await fetch(`/api/v1/practice/${start.sessionId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: payload }),
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
      {saveError && (
        <LearningSaveRecovery endpoint={`/api/v1/practice/${start.sessionId}`} error={saveError} />
      )}
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
          disabled={phase === 'submitting'}
          aria-disabled={phase === 'submitting'}
          aria-busy={phase === 'submitting'}
        >
          {phase === 'submitting' ? 'Grading…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}

// ---- Speaking runner ----

async function finishPractice(sessionId: string) {
  const response = await fetch(`/api/v1/practice/${sessionId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: [] }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Could not finish practice. Please try again.');
  }
  return practiceReceiptSchema.parse(await response.json());
}

function SpeakingRunner({
  start,
  onDone,
}: {
  start: Extract<PracticeStart, { status: 'ready_speaking' }>;
  onDone: () => void;
}) {
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SubmitResult | null>(null);

  async function finish() {
    setFinishing(true);
    setError('');
    try {
      setResult(await finishPractice(start.sessionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not finish practice.');
    } finally {
      setFinishing(false);
    }
  }

  if (result) return <ResultPanel result={result} onDone={onDone} />;
  return (
    <div className={styles.runner}>
      <SpeakingExercise
        endpointBase={`/api/v1/practice/${start.sessionId}/speaking`}
        prompts={start.prompts}
      />
      {error && (
        <p className={styles.errorBanner} role="alert">
          {error}
        </p>
      )}
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
  const [error, setError] = useState('');
  const [result, setResult] = useState<SubmitResult | null>(null);

  const prompts: WritingPromptData[] = useMemo(
    () =>
      start.prompts.map((p, idx) => ({
        id: p.id,
        order: idx,
        task: p.task,
        guidance: p.guidance ?? null,
        ideas: p.ideas ?? [],
        response: p.response ?? null,
        savedDraft: start.writingDrafts?.[p.id] ?? p.savedDraft,
      })),
    [start.prompts, start.writingDrafts]
  );

  const drafts = useWritingDrafts(
    prompts,
    `/api/v1/practice/${start.sessionId}/writing`,
    undefined,
    start.progressRevision ?? 0
  );

  async function finish() {
    setFinishing(true);
    // Grade what was written, then apply SRS from the graded responses.
    const graded = await drafts.submit();
    if (!graded) {
      setFinishing(false);
      return;
    }

    setError('');
    try {
      setResult(await finishPractice(start.sessionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not finish practice.');
    } finally {
      setFinishing(false);
    }
  }

  if (result) return <ResultPanel result={result} onDone={onDone} />;
  return (
    <div className={styles.runner}>
      <WritingSection drafts={drafts} prompts={prompts} />
      {error && (
        <p className={styles.errorBanner} role="alert">
          {error}
        </p>
      )}
      {drafts.error && (
        <p className={styles.errorBanner} role="alert">
          {drafts.error}
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => void finish()}
          disabled={finishing || drafts.isSubmitting || drafts.isOverLimit}
          aria-busy={finishing || drafts.isSubmitting}
        >
          {finishing || drafts.isSubmitting ? 'Grading…' : 'Submit and finish'}
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
  const [answers, setAnswers] = useState<Record<string, number>>(
    () =>
      retainedLearningProgress(
        `/api/v1/practice/${start.sessionId}`,
        { answers: start.learnerAnswers ?? {} },
        start.progressRevision ?? 0
      ).answers ?? {}
  );
  const [phase, setPhase] = useState<'answering' | 'submitting' | 'result' | 'error'>('answering');
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState('');
  const saveError = useLearningProgress(
    `/api/v1/practice/${start.sessionId}`,
    { answers },
    phase === 'answering',
    start.progressRevision ?? 0
  );
  const [audioStatus, setAudioStatus] = useState(
    start.episodeId ? 'Audio generating' : 'Audio unavailable'
  );

  const writingPrompts: WritingPromptData[] = useMemo(
    () =>
      start.writingPrompts.map((p, idx) => ({
        id: p.id,
        order: idx,
        task: p.task,
        guidance: p.guidance ?? null,
        ideas: p.ideas ?? [],
        response: p.response ?? null,
        savedDraft: start.writingDrafts?.[p.id] ?? p.savedDraft,
      })),
    [start.writingPrompts, start.writingDrafts]
  );

  const drafts = useWritingDrafts(
    writingPrompts,
    `/api/v1/practice/${start.sessionId}/writing`,
    undefined,
    start.progressRevision ?? 0
  );

  const submit = useCallback(async () => {
    setPhase('submitting');
    setError('');

    const graded = await drafts.submit();
    if (!graded) {
      setPhase('answering');
      return;
    }

    const payload = Object.entries(answers).map(([itemId, selectedIndex]) => ({
      itemId,
      selectedIndex,
    }));

    try {
      const res = await fetch(`/api/v1/practice/${start.sessionId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: payload }),
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
  }, [answers, drafts, start.sessionId]);

  if (phase === 'result' && result) {
    return <ResultPanel result={result} onDone={onDone} />;
  }

  return (
    <div className={styles.runner}>
      {saveError && (
        <LearningSaveRecovery endpoint={`/api/v1/practice/${start.sessionId}`} error={saveError} />
      )}
      <p className={styles.progressHint}>
        Open a section to practice. Your answers stay here while you move between sections.
      </p>
      {MC_SECTIONS.map(({ prefix, title }) => {
        const items = start.items.filter((item) => item.id.startsWith(prefix));
        if ((prefix === 'f' || prefix === 'v') && items.length === 0) return null;
        return (
          <PracticeSection
            key={prefix}
            title={title}
            progress={`${prefix === 'l' ? `${audioStatus} · ` : ''}${items.filter((item) => answers[item.id] !== undefined).length} of ${items.length} answered`}
          >
            {prefix === 'l' &&
              (start.skillRequirements?.skills.LISTENING.state === 'EXEMPT_NO_PROVIDER' ? (
                <p role="status">Listening is exempt because no TTS provider is connected.</p>
              ) : start.episodeId ? (
                <ListeningAudio
                  key={start.episodeId}
                  episodeId={start.episodeId}
                  onStatusChange={setAudioStatus}
                />
              ) : (
                <p className={styles.errorBanner} role="alert">
                  This session has no listening audio. Start a new full practice.
                </p>
              ))}
            {items.length > 0 ? (
              <MultipleChoiceList
                courseId={courseId}
                sessionId={start.sessionId}
                items={items}
                answers={answers}
                onAnswer={(itemId, selectedIndex) =>
                  setAnswers((prev) => ({ ...prev, [itemId]: selectedIndex }))
                }
              />
            ) : (
              <p role="status">This session has no {title.toLowerCase()} questions.</p>
            )}
          </PracticeSection>
        );
      })}

      <PracticeSection title="Speaking" progress={`${start.speakingPrompts.length} exercises`}>
        {start.skillRequirements?.skills.SPEAKING.state === 'EXEMPT_NO_PROVIDER' ? (
          <p role="status">Speaking is exempt because no STT provider is connected.</p>
        ) : start.speakingPrompts.length > 0 ? (
          <SpeakingExercise
            endpointBase={`/api/v1/practice/${start.sessionId}/speaking`}
            prompts={start.speakingPrompts}
          />
        ) : (
          <p className={styles.errorBanner} role="alert">
            This session has no speaking exercises. Start a new full practice.
          </p>
        )}
      </PracticeSection>

      {writingPrompts.length > 0 && (
        <PracticeSection title="Writing" progress={`${writingPrompts.length} exercises`}>
          <WritingSection drafts={drafts} prompts={writingPrompts} />
        </PracticeSection>
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
          disabled={phase === 'submitting' || drafts.isSubmitting || drafts.isOverLimit}
          aria-disabled={phase === 'submitting' || drafts.isSubmitting || drafts.isOverLimit}
          aria-busy={phase === 'submitting' || drafts.isSubmitting}
        >
          {phase === 'submitting' || drafts.isSubmitting ? 'Finishing…' : 'Submit and finish'}
        </button>
      </div>
    </div>
  );
}

export function PracticeRunner({ courseId, start, onDone }: PracticeRunnerProps) {
  if (start.submissionResult)
    return <ResultPanel result={start.submissionResult} onDone={onDone} />;
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
