'use client';

import { useEffect, useRef, useState } from 'react';
import {
  vocabularyRefillResponseSchema,
  vocabularyStudySessionSchema,
  type VocabularyRefillResponse,
  type VocabularyStudySession,
} from '@sotto/shared';
import styles from './VocabularyStudyRunner.module.css';

export function VocabularyRefill({
  courseId,
  profileId,
  sessionId,
  onContinue,
}: {
  courseId: string;
  profileId?: string;
  sessionId?: string;
  onContinue: (session: VocabularyStudySession) => void;
}) {
  const [value, setValue] = useState<VocabularyRefillResponse | null>(null);
  const [loadError, setError] = useState('');
  const error = loadError || (!profileId ? 'The current learner could not be verified.' : '');
  const [revision, setRevision] = useState(0);
  const [starting, setStarting] = useState(false);
  const shouldRetry = useRef(false);
  const continuation = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      continuation.current?.abort();
    },
    []
  );
  const endpoint = `/api/v1/courses/${encodeURIComponent(courseId)}/vocabulary/refill`;
  useEffect(() => {
    if (!profileId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryRequested = shouldRetry.current;
    shouldRetry.current = false;
    let polls = 0;
    async function request(method: 'GET' | 'POST', body?: unknown) {
      const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
      const response = await fetch(`${endpoint}${method === 'GET' ? query : ''}`, {
        method,
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'x-sotto-expected-profile-id': profileId!,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok)
        throw new Error('New words are unavailable. Check the server and try again.');
      return vocabularyRefillResponseSchema.parse(await response.json());
    }
    async function check() {
      try {
        let result = await request('GET');
        if (
          result.status === 'AVAILABLE' ||
          (retryRequested && result.status === 'FAILED' && result.canRetry)
        ) {
          if (!result.request) throw new Error('The refill request is incomplete.');
          retryRequested = false;
          result = await request('POST', result.request);
        }
        if (controller.signal.aborted) return;
        if (result.status === 'READY' && (!result.nextSessionId || !result.wordIds?.length))
          throw new Error('The new words could not be verified.');
        setValue(result);
        setError('');
        if (result.status === 'PENDING') {
          if (++polls >= 180) setError('New words are still preparing. Check their status again.');
          else timer = setTimeout(() => void check(), 2000);
        }
      } catch {
        if (!controller.signal.aborted)
          setError('New words could not be loaded. Check their status and try again.');
      }
    }
    void check();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [courseId, endpoint, profileId, revision, sessionId]);

  async function continuePractice() {
    if (!value?.nextSessionId || !value.wordIds?.length || !profileId) return;
    const controller = new AbortController();
    continuation.current = controller;
    setStarting(true);
    setError('');
    try {
      const response = await fetch(
        `/api/v1/courses/${encodeURIComponent(courseId)}/vocabulary/study`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'x-sotto-expected-profile-id': profileId },
          body: JSON.stringify({
            requestId: value.nextSessionId,
            mode: 'FLASHCARDS',
            wordIds: value.wordIds,
          }),
        }
      );
      if (!response.ok) throw new Error('The new practice could not be opened. Try again.');
      const session = vocabularyStudySessionSchema.parse(await response.json());
      if (
        session.sessionId !== value.nextSessionId ||
        session.courseId !== courseId ||
        session.profileId !== profileId ||
        session.mode !== 'FLASHCARDS'
      )
        throw new Error('The new practice could not be verified. Try again.');
      if (!controller.signal.aborted) onContinue(session);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'The new practice could not be opened.');
    } finally {
      if (!controller.signal.aborted) setStarting(false);
    }
  }

  if (value?.status === 'NOT_NEEDED' && !error) return null;
  return (
    <section className={styles.refill} aria-live="polite">
      <h3>More words</h3>
      {(!value || value.status === 'PENDING' || value.status === 'AVAILABLE') && !error && (
        <p>Preparing new words…</p>
      )}
      {value?.status === 'READY' && (
        <>
          <p>{value.added ? `${value.added} new words are ready.` : 'More words are ready.'}</p>
          <button
            className={styles.primary}
            disabled={starting || !value.nextSessionId || !value.wordIds?.length}
            onClick={() => void continuePractice()}
          >
            {starting ? 'Opening…' : 'Continue with new words'}
          </button>
        </>
      )}
      {value?.status === 'FAILED' && <p>{value.error ?? 'New words could not be prepared.'}</p>}
      {error && <p role="alert">{error}</p>}
      {(error || (value?.status === 'FAILED' && value.canRetry)) && (
        <button
          className={styles.secondary}
          onClick={() => {
            shouldRetry.current = !error;
            setError('');
            setRevision((current) => current + 1);
          }}
        >
          {error ? 'Check new words' : 'Try again'}
        </button>
      )}
    </section>
  );
}
