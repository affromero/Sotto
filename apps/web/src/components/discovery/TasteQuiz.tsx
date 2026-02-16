'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { TasteQuestion, TasteAnswer } from '@sotto/shared';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import styles from './TasteQuiz.module.css';

interface TasteQuizProps {
  initialQuestions: TasteQuestion[];
  onComplete: (answers: TasteAnswer[]) => Promise<void>;
  onRequestMore: () => Promise<TasteQuestion[]>;
  onSkipAll?: () => void;
}

type Direction = 'left' | 'right' | null;

export function TasteQuiz({
  initialQuestions,
  onComplete,
  onRequestMore,
  onSkipAll,
}: TasteQuizProps) {
  const [questions, setQuestions] = useState<TasteQuestion[]>(initialQuestions);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<TasteAnswer[]>([]);
  const [exitDirection, setExitDirection] = useState<Direction>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Swipe support
  const cardRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchDeltaX = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState(0);

  const currentQuestion = questions[currentIndex];
  const total = questions.length;
  const progress = total > 0 ? ((currentIndex) / total) * 100 : 0;

  const handleAnswer = useCallback(
    (response: 'yes' | 'no' | 'skip') => {
      if (isAnimating || !currentQuestion) return;

      const direction: Direction = response === 'yes' ? 'right' : response === 'no' ? 'left' : null;
      setExitDirection(direction);
      setIsAnimating(true);

      const answer: TasteAnswer = {
        questionId: currentQuestion.id,
        question: currentQuestion.text,
        tagSlugs: currentQuestion.tagSlugs,
        response,
      };

      setTimeout(() => {
        setAnswers((prev) => [...prev, answer]);
        setExitDirection(null);
        setSwipeOffset(0);
        setIsAnimating(false);

        if (currentIndex + 1 >= total) {
          setIsDone(true);
        } else {
          setCurrentIndex((prev) => prev + 1);
        }
      }, 300);
    },
    [isAnimating, currentQuestion, currentIndex, total]
  );

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isDone || isAnimating) return;
      if (e.key === 'ArrowRight' || e.key === 'y') handleAnswer('yes');
      else if (e.key === 'ArrowLeft' || e.key === 'n') handleAnswer('no');
      else if (e.key === 's' || e.key === 'Tab') {
        e.preventDefault();
        handleAnswer('skip');
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDone, isAnimating, handleAnswer]);

  // Touch handlers for swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const delta = e.touches[0].clientX - touchStartX.current;
    touchDeltaX.current = delta;
    setSwipeOffset(delta);
  };

  const handleTouchEnd = () => {
    const threshold = 80;
    if (touchDeltaX.current > threshold) {
      handleAnswer('yes');
    } else if (touchDeltaX.current < -threshold) {
      handleAnswer('no');
    } else {
      setSwipeOffset(0);
    }
    touchDeltaX.current = 0;
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await onComplete(answers);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMore = async () => {
    setIsLoadingMore(true);
    try {
      const moreQuestions = await onRequestMore();
      setQuestions(moreQuestions);
      setCurrentIndex(0);
      setIsDone(false);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Loading state (no questions yet)
  if (questions.length === 0 && !isDone) {
    return (
      <div className={styles.loading}>
        <Spinner size="large" />
        <p className={styles.loadingText}>Generating questions...</p>
      </div>
    );
  }

  // Completion state
  if (isDone) {
    const yesCount = answers.filter((a) => a.response === 'yes').length;
    const noCount = answers.filter((a) => a.response === 'no').length;

    return (
      <div className={styles.done}>
        <div className={styles.doneIcon}>&#10003;</div>
        <h3 className={styles.doneTitle}>Nice taste!</h3>
        <p className={styles.doneSummary}>
          {yesCount} yes, {noCount} no, {answers.length - yesCount - noCount} skipped
        </p>
        <div className={styles.doneActions}>
          <Button onClick={handleSubmit} loading={isSubmitting} disabled={isSubmitting}>
            Done
          </Button>
          <Button
            variant="secondary"
            onClick={handleMore}
            loading={isLoadingMore}
            disabled={isLoadingMore || isSubmitting}
          >
            More questions
          </Button>
        </div>
      </div>
    );
  }

  // Card rotation based on swipe
  const rotation = swipeOffset * 0.05;
  const cardStyle: React.CSSProperties = exitDirection
    ? {}
    : {
        transform: `translateX(${swipeOffset}px) rotate(${rotation}deg)`,
      };

  return (
    <div className={styles.quiz}>
      {/* Progress bar */}
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${progress}%` }} />
      </div>
      <div className={styles.progressLabel}>
        {currentIndex + 1} of {total}
      </div>

      {/* Card */}
      <div className={styles.cardContainer}>
        <div
          ref={cardRef}
          className={`${styles.card} ${exitDirection === 'right' ? styles.exitRight : ''} ${exitDirection === 'left' ? styles.exitLeft : ''}`}
          style={cardStyle}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <p className={styles.questionText}>{currentQuestion?.text}</p>

          {/* Swipe hint indicators */}
          <div
            className={`${styles.swipeHint} ${styles.swipeYes}`}
            style={{ opacity: Math.max(0, swipeOffset / 120) }}
          >
            Yes
          </div>
          <div
            className={`${styles.swipeHint} ${styles.swipeNo}`}
            style={{ opacity: Math.max(0, -swipeOffset / 120) }}
          >
            No
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.answerBtn} ${styles.noBtn}`}
          onClick={() => handleAnswer('no')}
          disabled={isAnimating}
          aria-label="Not for me"
        >
          Not for me
        </button>
        <button
          type="button"
          className={`${styles.answerBtn} ${styles.yesBtn}`}
          onClick={() => handleAnswer('yes')}
          disabled={isAnimating}
          aria-label="Yes, I'd listen"
        >
          Yes, I&apos;d listen
        </button>
      </div>

      <button
        type="button"
        className={styles.skipBtn}
        onClick={() => handleAnswer('skip')}
        disabled={isAnimating}
      >
        Skip
      </button>

      {onSkipAll && (
        <button type="button" className={styles.skipAllBtn} onClick={onSkipAll}>
          Skip the quiz
        </button>
      )}
    </div>
  );
}
