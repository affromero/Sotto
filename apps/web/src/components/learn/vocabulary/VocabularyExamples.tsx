'use client';

import { useEffect, useRef, useState } from 'react';
import { vocabularyExamplesResponseSchema, type VocabularyExamplesResponse } from '@sotto/shared';
import styles from './VocabularyStudyRunner.module.css';

export function VocabularyExamples({
  sessionId,
  cardId,
  profileId,
  revealed,
}: {
  sessionId: string;
  cardId: string;
  profileId?: string;
  revealed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const shouldRetry = useRef(false);
  const [value, setValue] = useState<VocabularyExamplesResponse | null>(null);
  const [error, setError] = useState('');
  const endpoint = `/api/v1/practice/${sessionId}/vocabulary/${cardId}/examples`;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryRequested = shouldRetry.current;
    let polls = 0;
    shouldRetry.current = false;
    async function request(method: 'GET' | 'POST', body?: unknown) {
      const response = await fetch(endpoint, {
        method,
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          ...(profileId && { 'x-sotto-expected-profile-id': profileId }),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok)
        throw new Error('Examples are unavailable. Check the server and try again.');
      return vocabularyExamplesResponseSchema.parse(await response.json());
    }
    async function check() {
      try {
        let result = await request('GET');
        if (
          result.status === 'AVAILABLE' ||
          (retryRequested && result.status === 'FAILED' && result.canRetry)
        ) {
          retryRequested = false;
          result = await request('POST', result.request);
        }
        if (controller.signal.aborted) return;
        setValue(result);
        setError('');
        if (result.status === 'PENDING') {
          if (++polls >= 180) setError('Examples are still preparing. Check their status again.');
          else timer = setTimeout(() => void check(), 2000);
        }
      } catch {
        if (!controller.signal.aborted)
          setError('Examples could not be loaded. Check the request and try again.');
      }
    }
    void check();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [endpoint, open, profileId, retry, revealed]);

  if (!open)
    return (
      <button className={styles.secondary} onClick={() => setOpen(true)}>
        See two examples
      </button>
    );
  return (
    <div className={styles.examples} aria-live="polite">
      <h3>In context</h3>
      {!value && !error && <p>Preparing examples…</p>}
      {value?.status === 'PENDING' && <p>Preparing examples…</p>}
      {value?.status === 'READY' && value.examples && (
        <ol>
          {value.examples.map((example, index) => (
            <li key={index}>
              <p>{example.sentence}</p>
              {example.translation && <p>{example.translation}</p>}
            </li>
          ))}
        </ol>
      )}
      {value?.status === 'FAILED' && <p>{value.error ?? 'Examples could not be prepared.'}</p>}
      {error && <p role="alert">{error}</p>}
      {(error || (value?.status === 'FAILED' && value.canRetry)) && (
        <button
          className={styles.secondary}
          onClick={() => {
            shouldRetry.current = !error;
            setError('');
            setRetry((current) => current + 1);
          }}
        >
          {error ? 'Check examples' : 'Try again'}
        </button>
      )}
    </div>
  );
}
