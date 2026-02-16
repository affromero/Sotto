'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Bookmark } from 'lucide-react';
import type { TasteQuestion, TasteAnswer } from '@sotto/shared';
import styles from './InspireQuiz.module.css';

interface InspireQuizProps {
  questions: TasteQuestion[];
  onSelectTopic: (topic: string) => void;
  onLoadMore: () => void;
  isLoadingMore: boolean;
}

type Direction = 'left' | 'right' | null;

export function InspireQuiz({ questions, onSelectTopic, onLoadMore, isLoadingMore }: InspireQuizProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [exitDirection, setExitDirection] = useState<Direction>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);

  const cardRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchDeltaX = useRef(0);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const currentQuestion = questions[currentIndex];
  const total = questions.length;
  const progress = total > 0 ? (currentIndex / total) * 100 : 0;

  // Reset state when questions change (new tab or load more)
  useEffect(() => {
    setCurrentIndex(0);
    setIsDone(false);
    setExitDirection(null);
    setSwipeOffset(0);
  }, [questions]);

  // Cleanup saved feedback timer
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const advanceCard = useCallback(
    (direction: Direction) => {
      if (isAnimating || !currentQuestion) return;

      setExitDirection(direction);
      setIsAnimating(true);

      setTimeout(() => {
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

  const handleNotForMe = useCallback(() => {
    if (isAnimating || !currentQuestion) return;

    // Send taste signal (fire-and-forget)
    const answer: TasteAnswer = {
      questionId: currentQuestion.id,
      question: currentQuestion.text,
      tagSlugs: currentQuestion.tagSlugs,
      response: 'no',
    };
    fetch('/api/taste-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [answer] }),
    });

    advanceCard('left');
  }, [isAnimating, currentQuestion, advanceCard]);

  const handleYesMakeThis = useCallback(() => {
    if (isAnimating || !currentQuestion) return;
    onSelectTopic(currentQuestion.text);
  }, [isAnimating, currentQuestion, onSelectTopic]);

  const handleSave = useCallback(async () => {
    if (isAnimating || !currentQuestion) return;

    try {
      await fetch('/api/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: currentQuestion.id,
          question: currentQuestion.text,
          tagSlugs: currentQuestion.tagSlugs,
          category: currentQuestion.category,
        }),
      });

      setSavedFeedback(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => {
        setSavedFeedback(false);
      }, 1500);
    } catch {
      // Silently fail
    }
  }, [isAnimating, currentQuestion]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isDone || isAnimating) return;
      if (e.key === 'ArrowRight' || e.key === 'y') handleYesMakeThis();
      else if (e.key === 'ArrowLeft' || e.key === 'n') handleNotForMe();
      else if (e.key === 'b') handleSave();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDone, isAnimating, handleYesMakeThis, handleNotForMe, handleSave]);

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
      handleYesMakeThis();
    } else if (touchDeltaX.current < -threshold) {
      handleNotForMe();
    } else {
      setSwipeOffset(0);
    }
    touchDeltaX.current = 0;
  };

  const handleLoadMore = () => {
    onLoadMore();
  };

  if (questions.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>No suggestions available right now. Try again later!</p>
      </div>
    );
  }

  if (isDone) {
    return (
      <div className={styles.done}>
        <p className={styles.doneText}>You have seen all questions in this batch.</p>
        <button
          type="button"
          className={styles.loadMoreBtn}
          onClick={handleLoadMore}
          disabled={isLoadingMore}
        >
          {isLoadingMore ? 'Loading...' : 'Load more'}
        </button>
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
          {currentQuestion?.category && (
            <span className={styles.categoryBadge}>{currentQuestion.category}</span>
          )}
          <p className={styles.questionText}>{currentQuestion?.text}</p>

          {/* Swipe hint indicators */}
          <div
            className={`${styles.swipeHint} ${styles.swipeMake}`}
            style={{ opacity: Math.max(0, swipeOffset / 120) }}
          >
            Make it
          </div>
          <div
            className={`${styles.swipeHint} ${styles.swipeNo}`}
            style={{ opacity: Math.max(0, -swipeOffset / 120) }}
          >
            Nope
          </div>
        </div>

        {/* Saved feedback */}
        {savedFeedback && <div className={styles.savedFeedback}>Saved!</div>}
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.answerBtn} ${styles.noBtn}`}
          onClick={handleNotForMe}
          disabled={isAnimating}
          aria-label="Not for me"
        >
          Not for me
        </button>
        <button
          type="button"
          className={`${styles.answerBtn} ${styles.saveBtn}`}
          onClick={handleSave}
          disabled={isAnimating}
          aria-label="Save idea"
        >
          <Bookmark size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${styles.answerBtn} ${styles.yesBtn}`}
          onClick={handleYesMakeThis}
          disabled={isAnimating}
          aria-label="Yes, make this"
        >
          Yes, make this
        </button>
      </div>
    </div>
  );
}
