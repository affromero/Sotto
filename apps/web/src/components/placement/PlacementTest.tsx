'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { placementSessionPublicSchema, type CefrLevel } from '@sotto/shared';
import { CefrDisclaimer } from '@/components/learn/CefrDisclaimer';
import { SottoSpinner } from '@/components/ui/SottoSpinner';
import type { MaterialPlacementReference } from '@/lib/course-materials/client/analysis';
import styles from './PlacementTest.module.css';

// ---- Types (mirrors API contract) ----

interface PlacementQuestion {
  id: string;
  cefr: string;
  skill: string;
  prompt: string;
  options: string[];
}
const placementResponseSchema = placementSessionPublicSchema
  .pick({
    placementSessionId: true,
    questionsDigest: true,
    status: true,
    failureReason: true,
    questions: true,
  })
  .partial()
  .extend({ error: z.string().optional() });

interface PlacementResult {
  courseId: string;
  level: CefrLevel;
  scoreBySkill: Record<string, number>;
}

type Phase = 'loading' | 'testing' | 'submitting' | 'result' | 'error' | 'expired';

const SKILL_LABELS: Record<string, string> = {
  grammar: 'Grammar',
  vocab: 'Vocabulary',
  reading: 'Reading',
};

const LEVEL_DESCRIPTIONS: Record<string, string> = {
  A1: 'Beginner: you are just starting out.',
  A2: 'Elementary: you can handle everyday basics.',
  B1: 'Intermediate: you can manage familiar topics.',
  B2: 'Upper Intermediate: you can discuss a wide range of subjects.',
  C1: 'Advanced: you can work with complex material and express precise ideas.',
  C2: 'Proficient: you can work on nuance, idiom, and flexible expression.',
};

interface PlacementTestProps {
  native: string;
  target: string;
  /** Display context for a shorter quiz bound to the exact source analysis. */
  focusLevel?: string;
  analysisReference?: MaterialPlacementReference;
}

export function PlacementTest({
  native,
  target,
  focusLevel,
  analysisReference,
}: PlacementTestProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<PlacementQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<PlacementResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const loadController = useRef<AbortController | null>(null);
  const generationRequest = useRef<string | null>(null);
  const confirmationRequest = useRef<string | null>(null);
  const session = useRef<{ placementSessionId: string; questionsDigest: string } | null>(null);
  const generationKey = useRef('');
  const submissionBody = useRef<string | null>(null);
  const [retrySubmission, setRetrySubmission] = useState(false);

  const loadQuestions = useCallback(async () => {
    const controller = new AbortController();
    loadController.current?.abort();
    loadController.current = controller;
    const current = () => !controller.signal.aborted && loadController.current === controller;
    try {
      const key = JSON.stringify({ native, target, analysisReference });
      if (generationKey.current !== key) {
        generationKey.current = key;
        generationRequest.current = null;
        confirmationRequest.current = null;
        session.current = null;
        submissionBody.current = null;
      }
      generationRequest.current ??= crypto.randomUUID();
      let res = await fetch('/api/v1/placement/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          schemaVersion: 1,
          native,
          target,
          requestId: generationRequest.current,
          ...analysisReference,
        }),
      });
      let data = placementResponseSchema.parse(await res.json());
      if (!current()) return;
      while (res.ok && res.status === 202) {
        if (!data.placementSessionId || !data.questionsDigest)
          throw new Error('Missing placement preparation receipt.');
        session.current = {
          placementSessionId: data.placementSessionId,
          questionsDigest: data.questionsDigest,
        };
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(controller.signal.reason);
          };
          const timer = setTimeout(() => {
            controller.signal.removeEventListener('abort', abort);
            resolve();
          }, 1_000);
          if (controller.signal.aborted) {
            abort();
            return;
          }
          controller.signal.addEventListener('abort', abort, { once: true });
        });
        res = await fetch(
          `/api/v1/placement?placementSessionId=${encodeURIComponent(data.placementSessionId)}`,
          { signal: controller.signal }
        );
        data = placementResponseSchema.parse(await res.json());
        if (!current()) return;
      }
      if (res.status === 401) {
        setErrorMessage('You must be signed in to take the placement test.');
        setPhase('error');
        return;
      }
      if (res.status === 400) {
        setErrorMessage('Invalid language pair.');
        setPhase('error');
        return;
      }
      if (res.status === 429) {
        setErrorMessage('Too many attempts. Please try again later.');
        setPhase('error');
        return;
      }
      if (!res.ok) {
        setErrorMessage(data.error ?? 'Failed to generate the placement test.');
        setPhase('error');
        return;
      }
      if (
        data.status !== 'READY' ||
        !data.placementSessionId ||
        !data.questionsDigest ||
        !data.questions?.length
      ) {
        if (data.status && ['FAILED', 'OUTPUT_INVALID', 'EXPIRED'].includes(data.status)) {
          generationRequest.current = null;
          confirmationRequest.current = null;
          session.current = null;
        }
        setErrorMessage(
          data.failureReason ??
            'The placement session is unavailable. Review its processing status before trying again.'
        );
        setPhase('error');
        return;
      }
      session.current = {
        placementSessionId: data.placementSessionId,
        questionsDigest: data.questionsDigest,
      };
      confirmationRequest.current ??= crypto.randomUUID();
      setQuestions(data.questions);
      setAnswers({});
      setCurrentIndex(0);
      setPhase('testing');
    } catch {
      // cancelPlacement already moved the learner out of the wait.
      if (!current()) return;
      setErrorMessage('A network error occurred. Please check your connection and try again.');
      setPhase('error');
    } finally {
      if (loadController.current === controller) loadController.current = null;
    }
  }, [native, target, analysisReference]);

  const cancelPlacement = useCallback(() => {
    loadController.current?.abort();
    loadController.current = null;
    setErrorMessage('Placement test cancelled.');
    setPhase('error');
  }, []);

  useEffect(() => {
    void (async () => {
      await loadQuestions();
    })();
    return () => {
      loadController.current?.abort();
    };
  }, [loadQuestions]);

  // Keyboard shortcut: number keys select an option (incl. the "I don't know"
  // option, which is always last), Enter advances.
  useEffect(() => {
    if (phase !== 'testing') return;
    const q = questions[currentIndex];
    if (!q) return;

    function onKey(e: KeyboardEvent) {
      const idx = parseInt(e.key) - 1;
      if (idx >= 0 && idx < q.options.length) {
        e.preventDefault();
        setAnswers((prev) => ({ ...prev, [q.id]: idx }));
        return;
      }
      if (e.key === 'Enter' && answers[q.id] !== undefined) {
        e.preventDefault();
        if (currentIndex < questions.length - 1) {
          setCurrentIndex((i) => i + 1);
        }
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, questions, currentIndex, answers]);

  async function submit() {
    setPhase('submitting');
    setRetrySubmission(true);
    const payload = {
      schemaVersion: 1,
      requestId: confirmationRequest.current,
      native,
      target,
      ...session.current,
      ...analysisReference,
      answers: Object.entries(answers).map(([id, selectedIndex]) => ({ id, selectedIndex })),
    };
    submissionBody.current ??= JSON.stringify(payload);
    try {
      const res = await fetch('/api/v1/placement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: submissionBody.current,
      });
      if (res.status === 409) {
        setRetrySubmission(false);
        submissionBody.current = null;
        generationRequest.current = null;
        confirmationRequest.current = null;
        session.current = null;
        setPhase('expired');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMessage(body.error ?? 'Submission failed. Please try again.');
        setPhase('error');
        return;
      }
      const data: PlacementResult = await res.json();
      setResult(data);
      setRetrySubmission(false);
      setPhase('result');
    } catch {
      setErrorMessage('A network error occurred while submitting. Please try again.');
      setPhase('error');
    }
  }

  const answeredCount = Object.keys(answers).length;
  const allAnswered = questions.length > 0 && answeredCount === questions.length;
  const q = questions[currentIndex];

  // ---- Render states ----

  if (phase === 'loading') {
    return (
      <div className={styles.center} role="status" aria-live="polite">
        <SottoSpinner
          size="large"
          label={
            focusLevel
              ? `Preparing questions around ${focusLevel}`
              : 'Generating your placement test'
          }
          orientation="stack"
        />
        <button type="button" className={styles.retryButton} onClick={cancelPlacement}>
          Cancel
        </button>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className={styles.center} role="alert">
        <div className={styles.errorIcon} aria-hidden="true">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <p className={styles.errorMessage}>{errorMessage}</p>
        <button
          className={styles.retryButton}
          onClick={() => {
            if (retrySubmission) {
              void submit();
              return;
            }
            setPhase('loading');
            setErrorMessage('');
            void loadQuestions();
          }}
        >
          {retrySubmission ? 'Retry submission' : 'Try again'}
        </button>
      </div>
    );
  }

  if (phase === 'expired') {
    return (
      <div className={styles.center} role="alert">
        <div className={styles.warningIcon} aria-hidden="true">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <p className={styles.errorMessage}>
          Your placement session expired. Start a fresh test to continue.
        </p>
        <button className={styles.retryButton} onClick={() => void loadQuestions()}>
          Start a new test
        </button>
      </div>
    );
  }

  if (phase === 'result' && result) {
    return (
      <div className={styles.result} role="main" aria-live="polite">
        <div className={styles.levelBadge} aria-label={`Assigned level: ${result.level}`}>
          <span className={styles.levelCode}>{result.level}</span>
          <span className={styles.levelLabel}>Your level</span>
        </div>

        <p className={styles.levelDescription}>{LEVEL_DESCRIPTIONS[result.level]}</p>

        <CefrDisclaimer />

        <section className={styles.skills} aria-label="Score breakdown by skill">
          <h2 className={styles.skillsHeading}>Skill breakdown</h2>
          <ul className={styles.skillList} role="list">
            {Object.entries(result.scoreBySkill).map(([skill, score]) => {
              const pct = Math.round(score * 100);
              return (
                <li key={skill} className={styles.skillItem}>
                  <div className={styles.skillMeta}>
                    <span className={styles.skillName}>{SKILL_LABELS[skill] ?? skill}</span>
                    <span className={styles.skillScore} aria-label={`${pct} percent`}>
                      {pct}%
                    </span>
                  </div>
                  <div
                    className={styles.progressTrack}
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${SKILL_LABELS[skill] ?? skill} score`}
                  >
                    <div
                      className={styles.progressFill}
                      style={{ '--pct': `${pct}%` } as React.CSSProperties}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <Link
          href="/learn"
          className={styles.startButton}
          aria-label="Start learning at your assigned level"
        >
          Start learning
        </Link>
      </div>
    );
  }

  if (phase === 'submitting') {
    return (
      <div className={styles.center} role="status" aria-live="polite">
        <SottoSpinner size="large" label="Calculating your level" orientation="stack" />
      </div>
    );
  }

  // ---- Main quiz ----

  const progressPct = Math.round((answeredCount / questions.length) * 100);

  return (
    <div className={styles.root}>
      {/* Progress bar */}
      <div
        className={styles.progressBar}
        role="progressbar"
        aria-valuenow={answeredCount}
        aria-valuemin={0}
        aria-valuemax={questions.length}
        aria-label={`${answeredCount} of ${questions.length} questions answered`}
      >
        <div
          className={styles.progressBarFill}
          style={{ '--pct': `${progressPct}%` } as React.CSSProperties}
        />
      </div>

      <div className={styles.meta}>
        <span className={styles.counter} aria-live="polite">
          {currentIndex + 1} / {questions.length}
        </span>
        <span className={styles.skillTag} aria-label={`Skill: ${SKILL_LABELS[q.skill] ?? q.skill}`}>
          {SKILL_LABELS[q.skill] ?? q.skill}
        </span>
      </div>

      <div className={styles.card}>
        <p className={styles.prompt} id={`question-${q.id}`}>
          {q.prompt}
        </p>

        <fieldset className={styles.options} aria-labelledby={`question-${q.id}`}>
          <legend className={styles.srOnly}>Choose the correct answer</legend>
          {q.options.map((option, idx) => {
            const selected = answers[q.id] === idx;
            return (
              <button
                key={idx}
                ref={(el) => {
                  optionRefs.current[idx] = el;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`${styles.option} ${selected ? styles.optionSelected : ''}`}
                onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: idx }))}
              >
                <span className={styles.optionKey} aria-hidden="true">
                  {idx + 1}
                </span>
                <span className={styles.optionText}>{option}</span>
              </button>
            );
          })}
        </fieldset>

        {/* Navigation */}
        <div className={styles.nav}>
          <button
            type="button"
            className={styles.navButton}
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            disabled={currentIndex === 0}
            aria-label="Previous question"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>

          {currentIndex < questions.length - 1 ? (
            <button
              type="button"
              className={`${styles.navButton} ${styles.navNext}`}
              onClick={() => setCurrentIndex((i) => i + 1)}
              disabled={answers[q.id] === undefined}
              aria-label="Next question"
            >
              Next
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.submitButton} ${allAnswered ? styles.submitReady : ''}`}
              onClick={() => void submit()}
              disabled={!allAnswered}
              aria-disabled={!allAnswered}
            >
              Submit
            </button>
          )}
        </div>
      </div>

      {/* Dot navigator */}
      <nav className={styles.dots} aria-label="Question navigation">
        {questions.map((question, idx) => (
          <button
            key={question.id}
            type="button"
            className={`${styles.dot} ${idx === currentIndex ? styles.dotCurrent : ''} ${answers[question.id] !== undefined ? styles.dotAnswered : ''}`}
            onClick={() => setCurrentIndex(idx)}
            aria-label={`Go to question ${idx + 1}${answers[question.id] !== undefined ? ', answered' : ''}`}
            aria-current={idx === currentIndex ? 'step' : undefined}
          />
        ))}
      </nav>

      <p className={styles.hint} aria-hidden="true">
        Tip: press <kbd>1</kbd> to <kbd>{q.options.length}</kbd> to select, <kbd>Enter</kbd> to
        advance
      </p>
    </div>
  );
}
