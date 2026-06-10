'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CefrDisclaimer } from '@/components/learn/CefrDisclaimer';
import styles from './PlacementTest.module.css';

// ---- Types (mirrors API contract) ----

interface PlacementQuestion {
  id: string;
  cefr: string;
  skill: string;
  prompt: string;
  options: string[];
}

interface PlacementResult {
  courseId: string;
  level: 'A1' | 'A2' | 'B1' | 'B2';
  scoreBySkill: Record<string, number>;
}

type Phase = 'loading' | 'testing' | 'submitting' | 'result' | 'error' | 'expired';

const SKILL_LABELS: Record<string, string> = {
  grammar: 'Grammar',
  vocab: 'Vocabulary',
  reading: 'Reading',
};

const LEVEL_DESCRIPTIONS: Record<string, string> = {
  A1: 'Beginner — you are just starting out.',
  A2: 'Elementary — you can handle everyday basics.',
  B1: 'Intermediate — you can manage familiar topics.',
  B2: 'Upper-Intermediate — you can discuss a wide range of subjects.',
};

interface PlacementTestProps {
  native: string;
  target: string;
}

export function PlacementTest({ native, target }: PlacementTestProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<PlacementQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<PlacementResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const loadQuestions = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/placement?native=${encodeURIComponent(native)}&target=${encodeURIComponent(target)}`,
      );
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
        const body = await res.json().catch(() => ({}));
        setErrorMessage(body.error ?? 'Failed to generate the placement test.');
        setPhase('error');
        return;
      }
      const data: { questions: PlacementQuestion[] } = await res.json();
      setQuestions(data.questions);
      setAnswers({});
      setCurrentIndex(0);
      setPhase('testing');
    } catch {
      setErrorMessage('A network error occurred. Please check your connection and try again.');
      setPhase('error');
    }
  }, [native, target]);

  useEffect(() => {
    void (async () => {
      await loadQuestions();
    })();
  }, [loadQuestions]);

  // Keyboard shortcut: 1-4 selects option, Enter advances
  useEffect(() => {
    if (phase !== 'testing') return;
    const q = questions[currentIndex];
    if (!q) return;

    function onKey(e: KeyboardEvent) {
      const idx = parseInt(e.key) - 1;
      if (idx >= 0 && idx <= 3 && idx < q.options.length) {
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
    const payload = {
      native,
      target,
      answers: Object.entries(answers).map(([id, selectedIndex]) => ({ id, selectedIndex })),
    };
    try {
      const res = await fetch('/api/placement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
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
        <div className={styles.spinner} aria-hidden="true" />
        <p className={styles.loadingText}>Generating your placement test...</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className={styles.center} role="alert">
        <div className={styles.errorIcon} aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <p className={styles.errorMessage}>{errorMessage}</p>
        <button
          className={styles.retryButton}
          onClick={() => {
            setPhase('loading');
            setErrorMessage('');
            void loadQuestions();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (phase === 'expired') {
    return (
      <div className={styles.center} role="alert">
        <div className={styles.warningIcon} aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <p className={styles.errorMessage}>Your placement session expired. Start a fresh test to continue.</p>
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
                    <span className={styles.skillScore} aria-label={`${pct} percent`}>{pct}%</span>
                  </div>
                  <div className={styles.progressTrack} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${SKILL_LABELS[skill] ?? skill} score`}>
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

        <Link href="/learn" className={styles.startButton} aria-label="Start learning at your assigned level">
          Start learning
        </Link>
      </div>
    );
  }

  if (phase === 'submitting') {
    return (
      <div className={styles.center} role="status" aria-live="polite">
        <div className={styles.spinner} aria-hidden="true" />
        <p className={styles.loadingText}>Calculating your level...</p>
      </div>
    );
  }

  // ---- Main quiz ----

  const progressPct = Math.round((answeredCount / questions.length) * 100);

  return (
    <div className={styles.root}>
      {/* Progress bar */}
      <div className={styles.progressBar} role="progressbar" aria-valuenow={answeredCount} aria-valuemin={0} aria-valuemax={questions.length} aria-label={`${answeredCount} of ${questions.length} questions answered`}>
        <div className={styles.progressBarFill} style={{ '--pct': `${progressPct}%` } as React.CSSProperties} />
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
        <p className={styles.prompt} id={`question-${q.id}`}>{q.prompt}</p>

        <fieldset className={styles.options} aria-labelledby={`question-${q.id}`}>
          <legend className={styles.srOnly}>Choose the correct answer</legend>
          {q.options.map((option, idx) => {
            const selected = answers[q.id] === idx;
            return (
              <button
                key={idx}
                ref={(el) => { optionRefs.current[idx] = el; }}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`${styles.option} ${selected ? styles.optionSelected : ''}`}
                onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: idx }))}
              >
                <span className={styles.optionKey} aria-hidden="true">{idx + 1}</span>
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
        Tip: press <kbd>1</kbd>–<kbd>4</kbd> to select, <kbd>Enter</kbd> to advance
      </p>
    </div>
  );
}
