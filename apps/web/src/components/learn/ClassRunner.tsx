'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './ClassRunner.module.css';

// ---- Types (mirrors API contract) ----

interface Question {
  id: string;
  order: number;
  question: string;
  options: string[];
  passageRef?: string | null;
  correctIndex?: number;
  explanation?: string | null;
}

interface Section {
  id: string;
  skill: string;
  status: string;
  attempt: number;
  score: number | null;
  passed: boolean | null;
  questions: Question[];
}

interface ClassData {
  id: string;
  status: string;
  order: number;
  passThreshold: number;
  lesson: { title: string; level: string; objective: string };
  submitted: boolean;
  submission: { passed: boolean; overallScore: number } | null;
  sections: Section[];
}

interface SectionResult {
  id: string;
  skill: string;
  score: number;
  passed: boolean;
}

interface SubmitResult {
  passed: boolean;
  overallScore: number;
  passedSections: number;
  totalSections: number;
  sections: SectionResult[];
}

// ---- Helpers ----

const SKILL_LABELS: Record<string, string> = {
  GRAMMAR: 'Grammar',
  READING: 'Reading',
  LISTENING: 'Listening',
  SPEAKING: 'Speaking',
};

function skillLabel(skill: string): string {
  return SKILL_LABELS[skill] ?? skill;
}

function pct(score: number): string {
  return `${Math.round(score * 100)}%`;
}

interface ClassRunnerProps {
  classId: string;
}

type Phase = 'loading' | 'answering' | 'submitting' | 'result' | 'regenerating' | 'error';

export function ClassRunner({ classId }: ClassRunnerProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [cls, setCls] = useState<ClassData | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Used to manage focus on option buttons for keyboard navigation
  const optionButtonRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

  const loadClass = useCallback(async () => {
    try {
      const res = await fetch(`/api/classes/${classId}`);
      if (res.status === 404) {
        setErrorMessage('Class not found.');
        setPhase('error');
        return;
      }
      if (!res.ok) {
        setErrorMessage('Failed to load class. Please refresh.');
        setPhase('error');
        return;
      }
      const data = (await res.json()) as ClassData;
      setCls(data);

      // If already submitted, show result from existing submission
      if (data.submitted && data.submission) {
        const existingSectionResults: SectionResult[] = data.sections.map((s) => ({
          id: s.id,
          skill: s.skill,
          score: s.score ?? 0,
          passed: s.passed ?? false,
        }));
        setResult({
          passed: data.submission.passed,
          overallScore: data.submission.overallScore,
          passedSections: existingSectionResults.filter((s) => s.passed).length,
          totalSections: existingSectionResults.length,
          sections: existingSectionResults,
        });
        setPhase('result');
      } else {
        setPhase('answering');
      }
    } catch {
      setErrorMessage('Network error. Please refresh.');
      setPhase('error');
    }
  }, [classId]);

  useEffect(() => {
    void (async () => {
      await loadClass();
    })();
  }, [loadClass]);

  function selectAnswer(questionId: string, index: number) {
    setAnswers((prev) => ({ ...prev, [questionId]: index }));
  }

  function handleKeyDown(
    e: React.KeyboardEvent<HTMLButtonElement>,
    questionId: string,
    index: number,
    totalOptions: number,
  ) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIndex = (index + 1) % totalOptions;
      const key = `${questionId}-${nextIndex}`;
      optionButtonRefs.current.get(key)?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIndex = (index - 1 + totalOptions) % totalOptions;
      const key = `${questionId}-${prevIndex}`;
      optionButtonRefs.current.get(key)?.focus();
    }
  }

  const allAnswered =
    cls !== null &&
    cls.sections.every((s) => s.questions.every((q) => answers[q.id] !== undefined));

  async function handleSubmit() {
    if (!cls || !allAnswered) return;
    setPhase('submitting');
    setErrorMessage('');

    const answerList = Object.entries(answers).map(([questionId, selectedIndex]) => ({
      questionId,
      selectedIndex,
    }));

    try {
      const res = await fetch(`/api/classes/${classId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: answerList }),
      });
      if (res.status === 404) {
        setErrorMessage('Class not found.');
        setPhase('error');
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(body.error ?? 'Failed to submit. Please try again.');
        setPhase('answering');
        return;
      }
      const submitResult = (await res.json()) as SubmitResult;
      setResult(submitResult);
      // Reload class data so we get correctIndex + explanation
      const classRes = await fetch(`/api/classes/${classId}`);
      if (classRes.ok) {
        const updated = (await classRes.json()) as ClassData;
        setCls(updated);
      }
      setPhase('result');
    } catch {
      setErrorMessage('Network error. Please try again.');
      setPhase('answering');
    }
  }

  async function handleRegenerate() {
    setPhase('regenerating');
    setErrorMessage('');
    setAnswers({});
    setResult(null);
    try {
      const res = await fetch(`/api/classes/${classId}`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(body.error ?? 'Failed to regenerate. Please try again.');
        setPhase('result');
        return;
      }
      // Reload class with fresh questions
      await loadClass();
    } catch {
      setErrorMessage('Network error. Please try again.');
      setPhase('result');
    }
  }

  // ---- Render phases ----

  if (phase === 'loading') {
    return (
      <div className={styles.loading} role="status" aria-label="Loading class">
        <span className={styles.spinner} aria-hidden="true" />
        <p>Loading your class…</p>
      </div>
    );
  }

  if (phase === 'error' || !cls) {
    return (
      <div className={styles.error} role="alert">
        <p>{errorMessage || 'An unexpected error occurred.'}</p>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => {
            setPhase('loading');
            setErrorMessage('');
            void loadClass();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (phase === 'regenerating') {
    return (
      <div className={styles.loading} role="status" aria-label="Regenerating failed sections">
        <span className={styles.spinner} aria-hidden="true" />
        <p>Preparing new questions for the sections you missed…</p>
      </div>
    );
  }

  const submitted = phase === 'result';

  return (
    <div className={styles.root}>
      {/* Header */}
      <header className={styles.classHeader}>
        <div className={styles.classHeaderMeta}>
          <span className={styles.levelBadge}>{cls.lesson.level}</span>
          <span className={styles.classOrder}>Class {cls.order}</span>
        </div>
        <h1 className={styles.classTitle}>{cls.lesson.title}</h1>
        <p className={styles.classObjective}>{cls.lesson.objective}</p>
      </header>

      {/* Sections */}
      <div className={styles.sections}>
        {cls.sections.map((section) => {
          const sectionResult = result?.sections.find((r) => r.id === section.id) ?? null;

          return (
            <section
              key={section.id}
              className={styles.section}
              aria-label={`${skillLabel(section.skill)} section`}
            >
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>{skillLabel(section.skill)}</h2>
                {submitted && sectionResult && (
                  <span
                    className={`${styles.sectionBadge} ${sectionResult.passed ? styles.sectionBadgePassed : styles.sectionBadgeFailed}`}
                    aria-label={`${sectionResult.passed ? 'Passed' : 'Failed'} — score ${pct(sectionResult.score)}`}
                  >
                    {sectionResult.passed ? 'Passed' : 'Failed'} · {pct(sectionResult.score)}
                  </span>
                )}
              </div>

              <ol className={styles.questionList}>
                {section.questions.map((q) => {
                  const selected = answers[q.id];
                  const isSubmitted = submitted;
                  const options = Array.isArray(q.options) ? (q.options as string[]) : [];

                  return (
                    <li key={q.id} className={styles.question}>
                      {/* Passage (READING) */}
                      {q.passageRef && (
                        <blockquote className={styles.passage}>{q.passageRef}</blockquote>
                      )}

                      <p className={styles.questionText}>{q.question}</p>

                      <div
                        className={styles.options}
                        role="group"
                        aria-label={`Options for: ${q.question}`}
                      >
                        {options.map((opt, idx) => {
                          const isSelected = selected === idx;
                          const isCorrect = isSubmitted && q.correctIndex === idx;
                          const isWrong = isSubmitted && isSelected && q.correctIndex !== idx;

                          let optClass = styles.option;
                          if (isSelected && !isSubmitted) optClass += ` ${styles.optionSelected}`;
                          if (isCorrect) optClass += ` ${styles.optionCorrect}`;
                          if (isWrong) optClass += ` ${styles.optionWrong}`;

                          const refKey = `${q.id}-${idx}`;

                          return (
                            <button
                              key={idx}
                              ref={(el) => {
                                optionButtonRefs.current.set(refKey, el);
                              }}
                              type="button"
                              className={optClass}
                              onClick={() => {
                                if (!isSubmitted) selectAnswer(q.id, idx);
                              }}
                              onKeyDown={(e) => handleKeyDown(e, q.id, idx, options.length)}
                              disabled={isSubmitted}
                              aria-pressed={isSelected}
                              aria-label={`Option ${idx + 1}: ${opt}${isCorrect ? ' — correct answer' : ''}${isWrong ? ' — wrong answer' : ''}`}
                            >
                              <span className={styles.optionLetter} aria-hidden="true">
                                {String.fromCharCode(65 + idx)}
                              </span>
                              <span className={styles.optionText}>{opt}</span>
                              {isCorrect && (
                                <span className={styles.optionIcon} aria-hidden="true">
                                  ✓
                                </span>
                              )}
                              {isWrong && (
                                <span className={styles.optionIcon} aria-hidden="true">
                                  ✗
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Explanation after submit */}
                      {isSubmitted && q.explanation && (
                        <p className={styles.explanation}>
                          <strong>Explanation:</strong> {q.explanation}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>

      {/* Error banner */}
      {errorMessage && (
        <p className={styles.errorBanner} role="alert">
          {errorMessage}
        </p>
      )}

      {/* Submit / Result actions */}
      {phase === 'answering' && (
        <div className={styles.actions}>
          <p className={styles.progressHint} aria-live="polite">
            {Object.keys(answers).length} of{' '}
            {cls.sections.reduce((sum, s) => sum + s.questions.length, 0)} questions answered
          </p>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handleSubmit()}
            disabled={!allAnswered}
            aria-disabled={!allAnswered}
          >
            Submit
          </button>
        </div>
      )}

      {phase === 'submitting' && (
        <div className={styles.loading} role="status" aria-label="Submitting answers">
          <span className={styles.spinner} aria-hidden="true" />
          <p>Grading your answers…</p>
        </div>
      )}

      {phase === 'result' && result && (
        <div className={styles.resultPanel} role="region" aria-label="Class result">
          <div
            className={`${styles.resultSummary} ${result.passed ? styles.resultPassed : styles.resultFailed}`}
          >
            <p className={styles.resultVerdict}>
              {result.passed ? 'Well done — you passed!' : 'Not quite — keep at it.'}
            </p>
            <p className={styles.resultScore}>
              {result.passedSections} of {result.totalSections} sections passed (
              {pct(result.overallScore)} overall)
            </p>
          </div>

          {result.passed ? (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                // We need the courseId — fetch from the class data
                // The courseId is not in ClassData directly; navigate via /learn and let StartNextClass handle it.
                // Instead, redirect to /learn where the user can click Continue.
                router.push('/learn');
              }}
            >
              Back to Courses
            </button>
          ) : (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void handleRegenerate()}
            >
              Try the failed sections again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
