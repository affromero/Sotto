'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  vocabularyStudyActionSchema,
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
import { VocabularyExamples } from './VocabularyExamples';
import { VocabularyRefill } from './VocabularyRefill';
import styles from './VocabularyStudyRunner.module.css';

export const STUDY_MODES = {
  FLASHCARDS: {
    title: 'Flashcards',
    hint: 'Swipe left if you’re still learning, or right if you know it. Your rating updates your review schedule.',
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
  onSessionChange,
}: {
  start: VocabularyStudySession;
  onDone: () => void;
  onSessionChange?: (session: VocabularyStudySession) => void;
}) {
  const [current, setCurrent] = useState(start);
  return (
    <VocabularyStudyRunnerContent
      key={current.sessionId}
      start={current}
      onDone={onDone}
      onContinue={(next) => {
        setCurrent(next);
        onSessionChange?.(next);
      }}
    />
  );
}

function VocabularyStudyRunnerContent({
  start,
  onDone,
  onContinue,
}: {
  start: VocabularyStudySession;
  onDone: () => void;
  onContinue: (session: VocabularyStudySession) => void;
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
  const [ratingConflict, setRatingConflict] = useState(false);
  const [ratingReady, setRatingReady] = useState(
    () => start.mode !== 'FLASHCARDS' || !start.selfRatingSupported || !start.profileId
  );
  const [ratingStorageError, setRatingStorageError] = useState(false);
  const pointerStart = useRef<{ id: number; x: number; y: number } | null>(null);
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
  const ratingKey = `vocabulary-rating:${start.profileId ?? ''}:${start.courseId}:${start.sessionId}`;

  useEffect(() => {
    if (start.mode !== 'FLASHCARDS' || !start.selfRatingSupported || !start.profileId) {
      return;
    }
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const raw = localStorage.getItem(ratingKey);
        if (raw) {
          const saved = vocabularyStudyActionSchema.parse(JSON.parse(raw));
          if (saved.action !== 'RATE') throw new Error('Invalid saved rating.');
          const savedIndex = start.cards.findIndex((item) => item.id === saved.itemId);
          if (savedIndex < 0) throw new Error('Saved rating belongs to another card.');
          setPending(saved);
          setIndex(savedIndex);
          setError('A saved rating needs confirmation. Retry it or check saved progress.');
        }
      } catch {
        setRatingStorageError(true);
        setError('The saved rating could not be read on this device.');
      }
      setRatingReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [ratingKey, start]);

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

  async function act(
    action: 'ANSWER' | 'REVEAL' | 'RATE' | 'COMPLETE',
    rating?: 'KNOWN' | 'UNKNOWN'
  ) {
    if (action === 'RATE' && !rating && !pending) return;
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
            : action === 'RATE'
              ? { action, expectedRevision: revision, itemId: card.id, rating: rating! }
              : { action, expectedRevision: revision });
      if (input.action === 'RATE') {
        if (!session.profileId) throw new Error('The current learner could not be verified.');
        const retained = localStorage.getItem(ratingKey);
        if (retained) {
          const previous = vocabularyStudyActionSchema.parse(JSON.parse(retained));
          if (
            previous.action !== 'RATE' ||
            previous.itemId !== input.itemId ||
            previous.expectedRevision !== input.expectedRevision ||
            previous.rating !== input.rating
          )
            throw new Error('A different rating is awaiting confirmation on this device.');
        }
        localStorage.setItem(ratingKey, JSON.stringify(input));
      }
      setPending(input);
      const response = await fetch(`${endpoint}/vocabulary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session.profileId && { 'x-sotto-expected-profile-id': session.profileId }),
        },
        body: JSON.stringify(input),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        if (input.action === 'RATE' && response.status === 409) setRatingConflict(true);
        else {
          if (input.action === 'RATE' && [400, 422].includes(response.status))
            localStorage.removeItem(ratingKey);
          if (input.action !== 'RATE' || [400, 422].includes(response.status)) setPending(null);
        }
        throw new Error(
          body && typeof body === 'object' && 'error' in body
            ? String(body.error)
            : 'Your answer could not be checked.'
        );
      }
      const updated = vocabularyStudySessionSchema.parse(body);
      if (
        updated.sessionId !== session.sessionId ||
        updated.courseId !== session.courseId ||
        updated.mode !== session.mode ||
        updated.profileId !== session.profileId
      )
        throw new Error(
          'The saved vocabulary response could not be verified. Retry the saved response.'
        );
      if (
        input.action === 'RATE' &&
        updated.cards.find((item) => item.id === input.itemId)?.feedback?.selfRating !==
          input.rating
      )
        throw new Error('The server did not confirm this rating. Retry the saved response.');
      if (input.action === 'RATE') localStorage.removeItem(ratingKey);
      setSession(updated);
      if (input.action === 'RATE' && input.rating === 'KNOWN' && index + 1 < updated.cards.length)
        setIndex(index + 1);
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

  async function checkSavedProgress() {
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        cache: 'no-store',
        headers: session.profileId ? { 'x-sotto-expected-profile-id': session.profileId } : {},
      });
      if (!response.ok) throw new Error('Saved practice could not be loaded.');
      const latest = vocabularyStudySessionSchema.parse(await response.json());
      if (
        latest.sessionId !== session.sessionId ||
        latest.courseId !== session.courseId ||
        latest.mode !== session.mode ||
        latest.profileId !== session.profileId
      )
        throw new Error('The saved practice could not be verified.');
      const next = latest.cards.findIndex((item) => !item.feedback);
      setSession(latest);
      setIndex(next < 0 ? latest.cards.length - 1 : next);
      localStorage.removeItem(ratingKey);
      setPending(null);
      setRatingConflict(false);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Saved practice could not be loaded.');
    } finally {
      setBusy(false);
    }
  }

  function startSwipe(event: PointerEvent<HTMLDivElement>) {
    if (
      !flashcards ||
      card.feedback ||
      busy ||
      pending ||
      saveError ||
      !ratingReady ||
      ratingStorageError ||
      !session.profileId ||
      !session.selfRatingSupported ||
      (event.target instanceof Element &&
        event.target.closest('button, input, textarea, select, a'))
    )
      return;
    pointerStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function finishSwipe(event: PointerEvent<HTMLDivElement>) {
    const startPoint = pointerStart.current;
    pointerStart.current = null;
    if (
      !startPoint ||
      startPoint.id !== event.pointerId ||
      busy ||
      pending ||
      saveError ||
      card.feedback
    )
      return;
    const x = event.clientX - startPoint.x;
    const y = event.clientY - startPoint.y;
    if (Math.abs(x) >= 80 && Math.abs(x) > Math.abs(y) * 1.5)
      void act('RATE', x > 0 ? 'KNOWN' : 'UNKNOWN');
  }

  if (session.receipt && ratingReady && !pending)
    return (
      <section className={styles.root}>
        <p className={styles.eyebrow}>Session complete</p>
        <h2 className={styles.title}>
          {flashcards ? 'A little more familiar.' : 'Recall checked.'}
        </h2>
        <p className={styles.summary}>
          {flashcards
            ? session.ratingSummary
              ? `${session.ratingSummary.known} known · ${session.ratingSummary.unknown} still learning.${session.ratingSummary.studied ? ` ${session.ratingSummary.studied} previously studied without a rating.` : ''}`
              : `${session.receipt.studied} ${session.receipt.studied === 1 ? 'word' : 'words'} studied.`
            : `${session.receipt.correct} of ${session.receipt.total} recalled. Your next reviews now reflect these answers.`}
        </p>
        {flashcards && (
          <VocabularyRefill
            courseId={session.courseId}
            profileId={session.profileId}
            sessionId={session.sessionId}
            onContinue={onContinue}
          />
        )}
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
      <div
        className={`${styles.card} ${flashcards ? styles.swipeCard : ''}`}
        onPointerDown={startSwipe}
        onPointerUp={finishSwipe}
        onPointerCancel={() => {
          pointerStart.current = null;
        }}
      >
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
        {flashcards && (
          <VocabularyExamples
            key={card.id}
            sessionId={session.sessionId}
            cardId={card.id}
            profileId={session.profileId}
            revealed={!!card.feedback}
          />
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
              {flashcards
                ? card.feedback.selfRating === 'KNOWN'
                  ? 'Known'
                  : card.feedback.selfRating === 'UNKNOWN'
                    ? 'Still learning'
                    : 'Study card'
                : card.feedback.correct
                  ? 'Recalled'
                  : 'Keep practicing'}
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
        ) : flashcards ? (
          <div className={styles.ratingActions}>
            <div className={styles.ratingButtons}>
              <button
                className={styles.secondary}
                disabled={
                  busy ||
                  awaitingConfirmation ||
                  !!saveError ||
                  !session.selfRatingSupported ||
                  !session.profileId ||
                  !ratingReady ||
                  ratingStorageError
                }
                onClick={() => void act('RATE', 'UNKNOWN')}
              >
                Still learning
              </button>
              <button
                className={styles.primary}
                disabled={
                  busy ||
                  awaitingConfirmation ||
                  !!saveError ||
                  !session.selfRatingSupported ||
                  !session.profileId ||
                  !ratingReady ||
                  ratingStorageError
                }
                onClick={() => void act('RATE', 'KNOWN')}
              >
                Know it
              </button>
            </div>
            <button
              className={styles.secondary}
              disabled={
                busy ||
                awaitingConfirmation ||
                !!saveError ||
                !session.selfRatingSupported ||
                !session.profileId ||
                !ratingReady ||
                ratingStorageError
              }
              onClick={() => void act('RATE', 'UNKNOWN')}
            >
              Reveal meaning
            </button>
            <small>Revealing the meaning counts as still learning.</small>
            {!session.selfRatingSupported && (
              <p role="alert">Update your Sotto server to use flashcard ratings.</p>
            )}
          </div>
        ) : (
          <button
            className={flashcards ? styles.primary : styles.secondary}
            disabled={busy || awaitingConfirmation || !!saveError}
            onClick={() => void act('REVEAL')}
          >
            I can’t recall it
          </button>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {awaitingConfirmation && !ratingConflict && (
        <button
          className={styles.primary}
          onClick={() =>
            void act(pending!.action, pending!.action === 'RATE' ? pending!.rating : undefined)
          }
        >
          Retry saved response
        </button>
      )}
      {ratingConflict && (
        <button
          className={styles.primary}
          disabled={busy}
          onClick={() => void checkSavedProgress()}
        >
          Check saved progress
        </button>
      )}
      <LearningSaveRecovery endpoint={endpoint} error={saveError} />
      <div className={styles.actions}>
        <button
          className={styles.secondary}
          onClick={() => void leave()}
          disabled={busy || pending?.action === 'RATE' || ratingStorageError}
        >
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
