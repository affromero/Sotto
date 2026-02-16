'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Bookmark, X, Sparkles, RefreshCw } from 'lucide-react';
import type { TasteQuestion, TasteAnswer } from '@sotto/shared';
import styles from './InspireQuiz.module.css';

interface InspireQuizProps {
  questions: TasteQuestion[];
  onSelectTopic: (topic: string) => void;
  onLoadMore: () => void;
  isLoadingMore: boolean;
}

interface GridCard {
  question: TasteQuestion;
  status: 'visible' | 'exiting' | 'entering';
}

const GRID_SIZE = 6;

export function InspireQuiz({ questions, onSelectTopic, onLoadMore, isLoadingMore }: InspireQuizProps) {
  const [gridCards, setGridCards] = useState<GridCard[]>(() =>
    questions.slice(0, GRID_SIZE).map((q) => ({ question: q, status: 'visible' as const }))
  );
  const queueRef = useRef<TasteQuestion[]>(questions.slice(GRID_SIZE));
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
  const savedTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Cleanup all saved feedback timers on unmount
  useEffect(() => {
    const timers = savedTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const handleNope = useCallback(
    (cardIndex: number) => {
      const card = gridCards[cardIndex];
      if (!card || card.status !== 'visible') return;

      // Send taste signal (fire-and-forget)
      const answer: TasteAnswer = {
        questionId: card.question.id,
        question: card.question.text,
        tagSlugs: card.question.tagSlugs,
        response: 'no',
      };
      fetch('/api/taste-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [answer] }),
      });

      // Start exit animation
      setGridCards((prev) =>
        prev.map((c, i) => (i === cardIndex ? { ...c, status: 'exiting' as const } : c))
      );

      // After evaporate animation, replace or fetch more
      setTimeout(() => {
        const currentQueue = queueRef.current;
        if (currentQueue.length > 0) {
          const [next, ...rest] = currentQueue;
          queueRef.current = rest;
          setGridCards((prev) =>
            prev.map((c, i) =>
              i === cardIndex ? { question: next, status: 'entering' as const } : c
            )
          );
          // Transition entering → visible after smoke-in completes
          setTimeout(() => {
            setGridCards((prev) =>
              prev.map((c, i) =>
                i === cardIndex && c.status === 'entering'
                  ? { ...c, status: 'visible' as const }
                  : c
              )
            );
          }, 400);
        } else {
          // Queue empty — remove card and auto-fetch fresh batch
          setGridCards((prev) => prev.filter((_, i) => i !== cardIndex));
          onLoadMore();
        }
      }, 350);
    },
    [gridCards, onLoadMore]
  );

  const handleSave = useCallback(
    async (cardIndex: number) => {
      const card = gridCards[cardIndex];
      if (!card || card.status !== 'visible') return;
      const id = card.question.id;

      try {
        await fetch('/api/ideas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            questionId: id,
            question: card.question.text,
            tagSlugs: card.question.tagSlugs,
            category: card.question.category,
          }),
        });

        setSavedIds((prev) => new Set(prev).add(id));

        // Clear existing timer for this card if any
        const existing = savedTimersRef.current.get(id);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
          setSavedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          savedTimersRef.current.delete(id);
        }, 1500);
        savedTimersRef.current.set(id, timer);
      } catch {
        // Silently fail
      }
    },
    [gridCards]
  );

  const handleMake = useCallback(
    (cardIndex: number) => {
      const card = gridCards[cardIndex];
      if (!card || card.status !== 'visible') return;
      onSelectTopic(card.question.topic);
    },
    [gridCards, onSelectTopic]
  );

  // Empty state — no questions at all
  if (questions.length === 0) {
    return (
      <div className={styles.empty}>
        <Sparkles size={24} className={styles.emptyIcon} aria-hidden="true" />
        <p className={styles.emptyText}>Let&apos;s find some ideas for you.</p>
        <button
          type="button"
          className={styles.shuffleBtn}
          onClick={onLoadMore}
          disabled={isLoadingMore}
        >
          {isLoadingMore ? (
            'Loading...'
          ) : (
            <>
              <Sparkles size={16} aria-hidden="true" />
              Generate ideas
            </>
          )}
        </button>
      </div>
    );
  }

  // All cards dismissed
  if (gridCards.length === 0) {
    return (
      <div className={styles.empty}>
        <RefreshCw size={24} className={styles.emptyIcon} aria-hidden="true" />
        <p className={styles.emptyText}>Ready for more ideas?</p>
        <button
          type="button"
          className={styles.shuffleBtn}
          onClick={onLoadMore}
          disabled={isLoadingMore}
        >
          {isLoadingMore ? (
            'Loading...'
          ) : (
            <>
              <RefreshCw size={16} aria-hidden="true" />
              Shuffle
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {gridCards.map((card, index) => {
        const isSaved = savedIds.has(card.question.id);
        const statusClass =
          card.status === 'exiting'
            ? styles.cardExiting
            : card.status === 'entering'
              ? styles.cardEntering
              : '';

        return (
          <div
            key={card.question.id}
            className={`${styles.card} ${statusClass}`}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            {card.question.category && (
              <span className={styles.categoryBadge}>{card.question.category}</span>
            )}
            <p className={styles.questionText}>{card.question.text}</p>

            {isSaved && <div className={styles.savedFeedback}>Saved!</div>}

            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.nopeBtn}`}
                onClick={() => handleNope(index)}
                disabled={card.status !== 'visible'}
                aria-label={`Dismiss: ${card.question.text}`}
              >
                <X size={14} aria-hidden="true" />
                <span>Nope</span>
              </button>
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.saveBtn}`}
                onClick={() => handleSave(index)}
                disabled={card.status !== 'visible'}
                aria-label={`Save: ${card.question.text}`}
              >
                <Bookmark size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.makeBtn}`}
                onClick={() => handleMake(index)}
                disabled={card.status !== 'visible'}
                aria-label={`Make podcast: ${card.question.text}`}
              >
                <Sparkles size={14} aria-hidden="true" />
                <span>Make</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
