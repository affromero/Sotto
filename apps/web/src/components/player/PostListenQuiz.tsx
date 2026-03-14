'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './PostListenQuiz.module.css';

interface QuizQuestion {
  id: string;
  order: number;
  question: string;
  options: string[];
  correctIndex?: number;
  explanation?: string;
}

interface SubmitResult {
  score: number;
  total: number;
  percentage: number;
  results: Array<{
    id: string;
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
    selectedIndex: number | null;
    isCorrect: boolean;
  }>;
}

interface PostListenQuizProps {
  podcastId: string;
  onDismiss: () => void;
}

type Phase = 'prompt' | 'quiz' | 'results';

export function PostListenQuiz({ podcastId, onDismiss }: PostListenQuizProps) {
  const [phase, setPhase] = useState<Phase>('prompt');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [answers, setAnswers] = useState<Map<string, number>>(new Map());
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Load quiz
  const loadQuiz = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/quiz`);
      if (!res.ok) {
        onDismiss();
        return;
      }
      const data = await res.json();
      if (data.hasSubmitted) {
        onDismiss();
        return;
      }
      setQuestions(data.questions);
      setPhase('quiz');
    } catch {
      onDismiss();
    } finally {
      setLoading(false);
    }
  }, [podcastId, onDismiss]);

  // Submit answers
  const submitQuiz = useCallback(async (finalAnswers: Map<string, number>) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/quiz/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: Array.from(finalAnswers.entries()).map(([questionId, si]) => ({
            questionId,
            selectedIndex: si,
          })),
        }),
      });
      if (res.ok) {
        const data: SubmitResult = await res.json();
        setResult(data);
        setPhase('results');
      }
    } catch {
      // Silent fail — quiz is non-critical
    } finally {
      setLoading(false);
    }
  }, [podcastId]);

  // Keyboard shortcuts
  useEffect(() => {
    if (phase !== 'quiz' || answered) return;
    function handleKey(e: KeyboardEvent) {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 4) {
        setSelectedIndex(num - 1);
      }
      if (e.key === 'Enter' && selectedIndex !== null) {
        handleConfirm();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  const currentQuestion = questions[currentIndex];

  function handleConfirm() {
    if (selectedIndex === null || !currentQuestion) return;
    setAnswered(true);
    const newAnswers = new Map(answers);
    newAnswers.set(currentQuestion.id, selectedIndex);
    setAnswers(newAnswers);

    // Move to next after a brief pause, or submit if last
    setTimeout(() => {
      if (currentIndex < questions.length - 1) {
        setCurrentIndex(currentIndex + 1);
        setSelectedIndex(null);
        setAnswered(false);
      } else {
        submitQuiz(newAnswers);
      }
    }, 300);
  }

  // Prompt phase
  if (phase === 'prompt') {
    return (
      <div className={styles.root}>
        <h3 className={styles.title}>Test your understanding</h3>
        <p className={styles.subtitle}>
          A quick quiz on what you just listened to.
        </p>
        <div className={styles.promptActions}>
          <button
            className={styles.primaryBtn}
            onClick={loadQuiz}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Take Quiz'}
          </button>
          <button className={styles.skipBtn} onClick={onDismiss}>
            Skip
          </button>
        </div>
      </div>
    );
  }

  // Results phase
  if (phase === 'results' && result) {
    return (
      <div className={styles.root}>
        <div className={styles.scoreCard}>
          <div className={styles.scoreValue}>
            {result.score}/{result.total}
          </div>
          <div className={styles.scoreLabel}>
            {result.percentage}% correct
          </div>
        </div>
        <div className={styles.reviewList}>
          {result.results.map((r, i) => (
            <div key={r.id} className={styles.reviewItem}>
              <div className={styles.reviewQuestion}>
                <span className={r.isCorrect ? styles.reviewCorrect : styles.reviewIncorrect}>
                  {r.isCorrect ? '\u2713' : '\u2717'}
                </span>{' '}
                {i + 1}. {r.question}
              </div>
              {!r.isCorrect && r.selectedIndex !== null && (
                <div className={styles.reviewExplanation}>
                  Your answer: {(r.options as string[])[r.selectedIndex]} &mdash;
                  Correct: {(r.options as string[])[r.correctIndex]}
                </div>
              )}
              <div className={styles.reviewExplanation}>{r.explanation}</div>
            </div>
          ))}
        </div>
        <div className={styles.actions}>
          <button className={styles.primaryBtn} onClick={onDismiss}>
            Done
          </button>
        </div>
      </div>
    );
  }

  // Quiz phase
  if (!currentQuestion) return null;

  const KEYS = ['A', 'B', 'C', 'D'];

  return (
    <div className={styles.root}>
      <div className={styles.progress}>
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
          />
        </div>
        <span className={styles.progressText}>
          {currentIndex + 1} / {questions.length}
        </span>
      </div>

      <p className={styles.question}>{currentQuestion.question}</p>

      <div className={styles.options}>
        {(currentQuestion.options as string[]).map((opt, i) => {
          let className = styles.option;
          if (selectedIndex === i) {
            className += ` ${styles.optionSelected}`;
          }

          return (
            <button
              key={i}
              className={className}
              onClick={() => !answered && setSelectedIndex(i)}
              disabled={answered}
              aria-label={`Option ${KEYS[i]}: ${opt}`}
            >
              <span className={styles.optionKey}>{KEYS[i]}</span>
              <span className={styles.optionText}>{opt}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.actions}>
        <button
          className={styles.primaryBtn}
          onClick={handleConfirm}
          disabled={selectedIndex === null || answered || loading}
        >
          {currentIndex < questions.length - 1 ? 'Next' : 'Submit'}
        </button>
      </div>
    </div>
  );
}
