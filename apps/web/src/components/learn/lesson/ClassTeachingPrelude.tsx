'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  classPreludeAcknowledgmentResponseSchema,
  classPreludeResponseSchema,
  type ClassPreludeResponse,
} from '@sotto/shared';
import { ClassNavigation } from '../navigation/ClassNavigation';
import { ClassPreludeContext } from './ClassPreludeContext';
import { quarantineClassLearningProgress } from '../progress/useLearningProgress';
import styles from './ClassTeachingPrelude.module.css';

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 2000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export function ClassTeachingPrelude({
  classId,
  children,
  quarantineOnEntry = false,
}: {
  classId: string;
  children: ReactNode;
  quarantineOnEntry?: boolean;
}) {
  const [value, setValue] = useState<ClassPreludeResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const active = useRef<AbortController | null>(null);
  const endpoint = `/api/v1/classes/${encodeURIComponent(classId)}/teaching-prelude`;

  const run = useCallback(
    async (action: 'read' | 'prepare' | 'acknowledge') => {
      if (active.current && !active.current.signal.aborted) return;
      const controller = new AbortController();
      active.current = controller;
      const { signal } = controller;
      const timeout = setTimeout(
        () => controller.abort(new Error('Check the saved status to continue.')),
        600_000
      );
      setBusy(true);
      setError('');
      const fetchPrelude = async (url: string, init?: RequestInit) => {
        const response = await fetch(url, { ...init, signal, cache: 'no-store' });
        const body: unknown = await response.json();
        signal.throwIfAborted();
        if (!response.ok)
          throw new Error('The lesson could not be prepared. Check the saved status.');
        return classPreludeResponseSchema.parse(body);
      };
      const prepare = (request: { sourceHash: string; snapshotHash: string }, recovery = false) =>
        fetchPrelude(`${endpoint}/prepare${recovery ? '?recover=1' : ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });
      try {
        let current: ClassPreludeResponse;
        if (action === 'acknowledge') {
          if (!value || (value.kind !== 'BASE' && value.kind !== 'ADDENDUM') || !value.receiptId)
            throw new Error('The lesson changed. Check the saved status.');
          const receipt = { kind: value.kind, receiptId: value.receiptId };
          const response = await fetch(`${endpoint}/acknowledge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(receipt),
            signal,
          });
          const body: unknown = await response.json();
          signal.throwIfAborted();
          if (!response.ok)
            throw new Error('Your place could not be saved. Check the saved status.');
          const accepted = classPreludeAcknowledgmentResponseSchema.parse(body);
          if (accepted.kind !== receipt.kind || accepted.receiptId !== receipt.receiptId)
            throw new Error('The lesson changed. Check the saved status.');
          current = await fetchPrelude(endpoint);
          if (
            current.kind !== receipt.kind ||
            !('receiptId' in current) ||
            current.receiptId !== receipt.receiptId ||
            current.acknowledged !== true
          )
            throw new Error('The lesson changed. Check the saved status.');
        } else if (action === 'prepare') {
          if (
            !value ||
            value.kind !== 'ADDENDUM' ||
            !(
              value.status === 'AVAILABLE' ||
              (['FAILED', 'STALE'].includes(value.status) && value.canRetry)
            )
          )
            throw new Error('The lesson changed. Check the saved status.');
          current = await prepare(value.request);
        } else {
          current = await fetchPrelude(endpoint);
        }
        for (;;) {
          signal.throwIfAborted();
          setValue(current);
          if (
            current.kind === 'NOT_REQUIRED' ||
            current.kind === 'REPLAY' ||
            ((current.kind === 'BASE' || current.kind === 'ADDENDUM') &&
              current.acknowledged === true)
          ) {
            setUnlocked(true);
            return;
          }
          if (
            current.kind !== 'GENERATING' &&
            !(current.kind === 'ADDENDUM' && current.status === 'PENDING')
          )
            return;
          await pause(signal);
          current =
            current.kind === 'ADDENDUM' && current.recoverable
              ? await prepare(current.request, true)
              : await fetchPrelude(endpoint);
        }
      } catch (failure) {
        if (
          !signal.aborted ||
          (signal.reason instanceof Error && signal.reason.name !== 'AbortError')
        ) {
          if (active.current === controller) {
            setValue(null);
            setError(
              signal.aborted && signal.reason instanceof Error
                ? signal.reason.message
                : failure instanceof Error
                  ? failure.message
                  : 'The lesson is unavailable. Check the saved status.'
            );
          }
        }
      } finally {
        clearTimeout(timeout);
        if (active.current === controller) {
          active.current = null;
          setBusy(false);
        }
      }
    },
    [endpoint, value]
  );

  const initialRead = useRef(run);
  const initialQuarantine = useRef(quarantineOnEntry ? `/api/v1/classes/${classId}` : null);
  useLayoutEffect(() => {
    if (initialQuarantine.current) quarantineClassLearningProgress(initialQuarantine.current);
  }, []);
  useEffect(() => {
    void initialRead.current('read');
    return () => {
      active.current?.abort();
    };
  }, []);

  if (unlocked)
    return <ClassPreludeContext.Provider value={value}>{children}</ClassPreludeContext.Provider>;
  const base = value?.kind === 'BASE' ? value : null;
  const addition = value?.kind === 'ADDENDUM' ? value : null;
  return (
    <div className={styles.shell}>
      <ClassNavigation currentSection="Before you practise" />
      <main className={styles.main}>
        <p className={styles.label}>Before you practise</p>
        {base && (
          <article lang={base.nativeLang}>
            <h1>{base.teaching.title}</h1>
            <p>{base.teaching.explanation}</p>
            <h2>Worked examples</h2>
            <ol>
              {base.teaching.workedExamples.map((example, index) => (
                <li key={index}>
                  <p>{example.prompt}</p>
                  <p lang={base.targetLang}>{example.answer}</p>
                  <p>{example.explanation}</p>
                </li>
              ))}
            </ol>
            <h2>Notice the difference</h2>
            <p lang={base.targetLang}>{base.teaching.commonMistake.incorrect}</p>
            <p lang={base.targetLang}>{base.teaching.commonMistake.correction}</p>
            <p>{base.teaching.commonMistake.explanation}</p>
          </article>
        )}
        {addition?.content && (
          <article lang={addition.nativeLang}>
            <h1>{addition.content.title}</h1>
            <p>{addition.content.explanation}</p>
            <ol>
              {addition.content.examples.map((example, index) => (
                <li key={index}>
                  <p lang={addition.targetLang}>{example.target}</p>
                  <p>{example.meaning}</p>
                  <p>{example.explanation}</p>
                </li>
              ))}
            </ol>
          </article>
        )}
        {addition?.status === 'AVAILABLE' && (
          <p>
            Get an explanation of the ideas you need before the exercises. This uses your configured
            AI provider and may take several minutes.
          </p>
        )}
        {addition && ['FAILED', 'STALE'].includes(addition.status) && (
          <p>
            {addition.failure === 'UNSAFE'
              ? 'This explanation could not be prepared safely.'
              : 'This explanation could not be prepared for this class.'}
          </p>
        )}
        {(value?.kind === 'UNAVAILABLE' ||
          addition?.status === 'UNAVAILABLE' ||
          addition?.status === 'UNRESOLVED') && (
          <p>This lesson needs recovery before practice can start.</p>
        )}
        {!busy &&
          !error &&
          (value?.kind === 'UNAVAILABLE' ||
            addition?.status === 'UNAVAILABLE' ||
            addition?.status === 'UNRESOLVED' ||
            (addition && ['FAILED', 'STALE'].includes(addition.status) && !addition.canRetry)) && (
            <button type="button" onClick={() => void run('read')}>
              Check saved status
            </button>
          )}
        {busy && (
          <p role="status">
            {value?.kind === 'GENERATING' ? 'Preparing your class' : 'Checking your lesson'}
          </p>
        )}
        {error && (
          <div role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => void run('read')}>
              Check saved status
            </button>
          </div>
        )}
        {!busy &&
          !error &&
          addition &&
          (addition.status === 'AVAILABLE' ||
            (['FAILED', 'STALE'].includes(addition.status) && addition.canRetry)) && (
            <button type="button" onClick={() => void run('prepare')}>
              Explain the basics
            </button>
          )}
        {!busy && !error && (base || addition?.status === 'READY') && (
          <button type="button" onClick={() => void run('acknowledge')}>
            Mark basics as read
          </button>
        )}
      </main>
    </div>
  );
}
