'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { ResolutionPrompt } from '@/components/chat/ResolutionPrompt';
import type { InteractionSummary } from '@/types/podcast';
import styles from './InterruptChatPanel.module.css';

interface InterruptChatPanelProps {
  podcastId: string;
  isOwner: boolean;
  podcastSource: string;
  currentTime: number;
  existingInteractions: InteractionSummary[];
  onClose: () => void;
  onQuestionAnswered?: () => void;
}

type PanelState =
  | 'idle'
  | 'submitting'
  | 'polling'
  | 'answered'
  | 'resolving'
  | 'resolved'
  | 'incorporating'
  | 'incorporated';

export function InterruptChatPanel({
  podcastId,
  isOwner,
  podcastSource,
  currentTime,
  existingInteractions,
  onClose,
  onQuestionAnswered,
}: InterruptChatPanelProps) {
  const [state, setState] = useState<PanelState>('idle');
  const [question, setQuestion] = useState('');
  const [activeInteractionId, setActiveInteractionId] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!question.trim()) return;
    setState('submitting');
    setError(null);

    try {
      const response = await fetch(`/api/podcasts/${podcastId}/interact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), timestamp: currentTime }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit question');
      }

      const data = await response.json();
      setActiveInteractionId(data.id);
      setState('polling');

      // Poll for answer
      pollRef.current = setInterval(async () => {
        if (document.visibilityState === 'hidden') return;
        try {
          const pollRes = await fetch(`/api/podcasts/${podcastId}/interact/${data.id}`);
          if (!pollRes.ok) return;
          const pollData = await pollRes.json();

          if (pollData.status === 'ANSWERED' && pollData.answer) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setAnswer(pollData.answer);
            setState('answered');
            onQuestionAnswered?.();
          }
        } catch {
          // Silently retry on next interval
        }
      }, 5000);

      // Safety timeout: stop polling after 60s
      setTimeout(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          if (state === 'polling') {
            setError('Answer is taking longer than expected. Please try again.');
            setState('idle');
          }
        }
      }, 60000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setState('idle');
    }
  }, [question, podcastId, currentTime, state, onQuestionAnswered]);

  const handleResolve = useCallback(
    async (helpful: boolean, incorporate: boolean) => {
      if (!activeInteractionId) return;

      // First resolve with helpful feedback
      setState('resolving');
      try {
        await fetch(`/api/podcasts/${podcastId}/interact/${activeInteractionId}/resolve`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ helpful }),
        });

        if (incorporate && isOwner) {
          setState('incorporating');
          const incRes = await fetch(
            `/api/podcasts/${podcastId}/interact/${activeInteractionId}/incorporate`,
            { method: 'POST' }
          );
          if (incRes.ok) {
            setState('incorporated');
          } else {
            setState('resolved');
          }
        } else {
          setState('resolved');
        }
      } catch {
        setState('resolved');
      }

      // Reset after a brief delay
      setTimeout(() => {
        setState('idle');
        setQuestion('');
        setAnswer(null);
        setActiveInteractionId(null);
      }, 2000);
    },
    [activeInteractionId, podcastId, isOwner]
  );

  return (
    <section className={styles.panel} aria-label="Ask a question about this podcast">
      <div className={styles.header}>
        <h3 className={styles.title}>Ask a Question</h3>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close question panel"
          type="button"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Previous Q&A */}
      {existingInteractions.length > 0 && (
        <div className={styles.historyList}>
          {existingInteractions.map((interaction) => (
            <div key={interaction.id} className={styles.historyItem}>
              <p className={styles.historyQuestion}>{interaction.question}</p>
              {interaction.answer && <p className={styles.historyAnswer}>{interaction.answer}</p>}
              <span className={styles.historyStatus}>
                {interaction.status.replace(/_/g, ' ').toLowerCase()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      {state === 'idle' && (
        <div className={styles.inputArea}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask anything about what you just heard..."
            disabled={state !== 'idle'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          {error && (
            <p className={styles.statusMessage} role="alert">
              {error}
            </p>
          )}
          <button
            className={styles.submitBtn}
            onClick={handleSubmit}
            disabled={!question.trim()}
            type="button"
          >
            Ask
          </button>
        </div>
      )}

      {/* Submitting / Polling */}
      {(state === 'submitting' || state === 'polling') && (
        <div className={styles.spinnerWrap}>
          <Spinner />
        </div>
      )}

      {/* Answer */}
      {state === 'answered' && answer && (
        <div className={styles.answerSection}>
          <p className={styles.answerLabel}>Answer</p>
          <p className={styles.answerText}>{answer}</p>
          <ResolutionPrompt
            onResolve={(helpful, incorporate) => handleResolve(helpful, incorporate)}
            canIncorporate={isOwner && podcastSource !== 'IMPORT'}
          />
        </div>
      )}

      {/* Resolving states */}
      {state === 'resolving' && (
        <div className={styles.spinnerWrap}>
          <Spinner />
        </div>
      )}

      {state === 'incorporating' && (
        <div className={styles.spinnerWrap}>
          <Spinner />
          <p className={styles.statusMessage}>Updating podcast with this explanation...</p>
        </div>
      )}

      {state === 'incorporated' && (
        <p className={styles.successMessage}>
          Podcast updated! The explanation has been incorporated.
        </p>
      )}

      {state === 'resolved' && <p className={styles.successMessage}>Thanks for your feedback!</p>}
    </section>
  );
}
