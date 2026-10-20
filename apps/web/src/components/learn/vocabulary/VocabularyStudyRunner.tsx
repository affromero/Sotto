'use client';

import { useState } from 'react';
import {
  vocabularyStudySessionSchema,
  type VocabularyStudyAction,
  type VocabularyStudySession,
} from '@sotto/shared';
import {
  flushLearningProgress,
  retainedLearningProgress,
  useLearningProgress,
} from '../progress/useLearningProgress';
import { LearningSaveRecovery } from '../progress/LearningSaveRecovery';
import { LocalPronunciation } from './LocalPronunciation';
import styles from './VocabularyStudyRunner.module.css';

export const STUDY_MODES = {
  FLASHCARDS: {
    title: 'Flashcards',
    hint: 'Meet the word and its meaning. Study builds familiarity; a recall check measures it.',
  },
  MEANING_RECALL: {
    title: 'Remember the meaning',
    hint: 'Look at the word. Try to retrieve its meaning before checking.',
  },
  WORD_RECALL: {
    title: 'Find the word',
    hint: 'Write the target word from its meaning. Keep its spelling, accents, and capitals.',
  },
  LISTENING_RECALL: {
    title: 'Listen and remember',
    hint: 'Play the pronunciation, then write its meaning from memory.',
  },
} as const;

export function VocabularyStudyRunner({
  start,
  onDone,
}: {
  start: VocabularyStudySession;
  onDone: () => void;
}) {
  const [session, setSession] = useState(start);
  const [index, setIndex] = useState(() => {
    const next = start.cards.findIndex((card) => !card.feedback);
    return next < 0 ? start.cards.length - 1 : next;
  });
  const endpoint = `/api/v1/practice/${start.sessionId}`;
  const [drafts, setDrafts] = useState(
    () =>
      retainedLearningProgress(
        endpoint,
        { writingDrafts: start.writingDrafts },
        start.progressRevision
      ).writingDrafts ?? {}
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<VocabularyStudyAction | null>(null);
  const flashcards = session.mode === 'FLASHCARDS';
  const saveError = useLearningProgress(
    endpoint,
    { writingDrafts: drafts },
    !session.receipt && !flashcards,
    session.progressRevision
  );
  const card = session.cards[index]!;
  const description = STUDY_MODES[session.mode];
  const awaitingConfirmation = pending !== null && !busy;

  async function leave() {
    setBusy(true);
    setError('');
    try {
      await flushLearningProgress(endpoint, '', session.progressRevision);
      onDone();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Your progress must be saved before leaving.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function act(action: 'ANSWER' | 'REVEAL' | 'COMPLETE') {
    setBusy(true);
    setError('');
    try {
      const revision = await flushLearningProgress(endpoint, '', session.progressRevision);
      const input =
        pending ??
        (action === 'ANSWER'
          ? { action, expectedRevision: revision, itemId: card.id, answer: drafts[card.id] ?? '' }
          : action === 'REVEAL'
            ? { action, expectedRevision: revision, itemId: card.id }
            : { action, expectedRevision: revision });
      setPending(input);
      const response = await fetch(`${endpoint}/vocabulary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setPending(null);
        throw new Error(
          body && typeof body === 'object' && 'error' in body
            ? String(body.error)
            : 'Your answer could not be checked.'
        );
      }
      setSession(vocabularyStudySessionSchema.parse(body));
      setPending(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The response was lost. Retry to check your saved answer.'
      );
    } finally {
      setBusy(false);
    }
  }

  if (session.receipt)
    return (
      <section className={styles.root}>
        <p className={styles.eyebrow}>Session complete</p>
        <h2 className={styles.title}>
          {flashcards ? 'A little more familiar.' : 'Recall checked.'}
        </h2>
        <p className={styles.summary}>
          {flashcards
            ? `${session.receipt.studied} ${session.receipt.studied === 1 ? 'word' : 'words'} studied. Try a separate recall check to see what stayed with you.`
            : `${session.receipt.correct} of ${session.receipt.total} recalled. Your next reviews now reflect these answers.`}
        </p>
        <button className={styles.primary} onClick={onDone}>
          Back to vocabulary
        </button>
      </section>
    );

  return (
    <section className={styles.root} aria-label={description.title}>
      <div className={styles.topline}>
        <p className={styles.eyebrow}>{description.title}</p>
        <span>
          {index + 1} / {session.cards.length}
        </span>
      </div>
      <progress
        className={styles.progress}
        max={session.cards.length}
        value={session.cards.filter((item) => item.feedback).length}
        aria-label="Words reviewed"
      />
      <p className={styles.hint}>{description.hint}</p>
      <div className={styles.card}>
        <p className={styles.eyebrow}>
          {session.mode === 'WORD_RECALL'
            ? 'Meaning'
            : flashcards
              ? 'Meet this word'
              : 'What does this mean?'}
        </p>
        <h2
          className={styles.word}
          lang={session.mode === 'WORD_RECALL' ? session.nativeLang : session.targetLang}
        >
          {card.prompt}
        </h2>
        {(session.mode !== 'WORD_RECALL' || card.feedback) && (
          <LocalPronunciation key={card.id} endpoint={`${endpoint}/vocabulary/${card.id}/audio`} />
        )}
        {!card.feedback && !flashcards && (
          <form
            className={styles.answer}
            onSubmit={(event) => {
              event.preventDefault();
              void act('ANSWER');
            }}
          >
            <label htmlFor={`answer-${card.id}`}>
              {session.mode === 'WORD_RECALL' ? 'The word' : 'Its meaning'}
            </label>
            <input
              id={`answer-${card.id}`}
              value={drafts[card.id] ?? ''}
              maxLength={1000}
              autoComplete="off"
              spellCheck={false}
              disabled={busy || pending !== null}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [card.id]: event.target.value }))
              }
            />
            <button
              className={styles.primary}
              disabled={busy || awaitingConfirmation || !drafts[card.id]?.trim() || !!saveError}
            >
              {busy ? 'Checking…' : 'Check answer'}
            </button>
          </form>
        )}
        {card.feedback ? (
          <div className={styles.feedback} aria-live="polite">
            <p className={styles.verdict}>
              {flashcards ? 'Study card' : card.feedback.correct ? 'Recalled' : 'Keep practicing'}
            </p>
            {session.mode !== 'MEANING_RECALL' && !flashcards && (
              <h3 lang={session.targetLang}>{card.feedback.lemma}</h3>
            )}
            <p lang={session.nativeLang}>{card.feedback.meaning}</p>
            {!flashcards && card.feedback.outcome === 'REVEALED' && (
              <small>
                Revealing an answer schedules more practice. It does not count as a successful
                recall.
              </small>
            )}
          </div>
        ) : (
          <button
            className={styles.secondary}
            disabled={busy || awaitingConfirmation || !!saveError}
            onClick={() => void act('REVEAL')}
          >
            {flashcards ? 'Reveal meaning' : 'I can’t recall it'}
          </button>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {awaitingConfirmation && (
        <button className={styles.primary} onClick={() => void act(pending!.action)}>
          Retry saved response
        </button>
      )}
      <LearningSaveRecovery endpoint={endpoint} error={saveError} />
      <div className={styles.actions}>
        <button className={styles.secondary} onClick={() => void leave()} disabled={busy}>
          Save and leave
        </button>
        {card.feedback &&
          (index < session.cards.length - 1 ? (
            <button className={styles.primary} onClick={() => setIndex(index + 1)}>
              Next word
            </button>
          ) : (
            <button
              className={styles.primary}
              disabled={busy || awaitingConfirmation}
              onClick={() => void act('COMPLETE')}
            >
              {busy ? 'Saving…' : 'Finish session'}
            </button>
          ))}
      </div>
    </section>
  );
}
