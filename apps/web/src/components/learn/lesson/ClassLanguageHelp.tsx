'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  classLessonHelpResponseSchema,
  classTeachingSchema,
  getLanguageLabel,
  type ClassLessonHelpResponse,
  type ClassTeaching,
} from '@sotto/shared';
import { SottoSpinner } from '@/components/ui/SottoSpinner';
import styles from './ClassLanguageHelp.module.css';

interface ClassLanguageHelpProps {
  classId: string;
  teaching: ClassTeaching;
}

async function teachingHash(teaching: ClassTeaching) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(classTeachingSchema.parse(teaching)))
  );
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

function pause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 2000);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export function ClassLanguageHelp({ classId, teaching }: ClassLanguageHelpProps) {
  return (
    <ClassLanguageHelpPane
      key={JSON.stringify([classId, teaching])}
      classId={classId}
      teaching={teaching}
    />
  );
}

function ClassLanguageHelpPane({ classId, teaching }: ClassLanguageHelpProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ClassLessonHelpResponse | null>(null);
  const [error, setError] = useState('');
  const endpoint = `/api/v1/classes/${classId}/lesson-help`;

  const close = useCallback(() => {
    active.current?.abort();
    setOpen(false);
    setBusy(false);
    setResult(null);
    setError('');
  }, []);

  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  async function load(retry = false) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(
      () =>
        controller.abort(
          new Error('Language help is taking longer than expected. Check its saved status.')
        ),
      600_000
    );
    setBusy(true);
    setError('');
    setResult(null);
    const signal = controller.signal;
    try {
      const hash = await teachingHash(teaching);
      signal.throwIfAborted();
      const read = async () => {
        const response = await fetch(endpoint, { signal, cache: 'no-store' });
        const body: unknown = await response.json();
        if (!response.ok)
          throw new Error(
            body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
              ? body.error
              : 'Language help could not be loaded.'
          );
        const parsed = classLessonHelpResponseSchema.safeParse(body);
        if (!parsed.success)
          throw new Error('Language help returned an incomplete response. Check its saved status.');
        const value = parsed.data;
        signal.throwIfAborted();
        if (value.request.sourceHash !== hash)
          throw new Error('The saved lesson changed. Reopen the class before requesting help.');
        return value;
      };
      let value = await read();
      setResult(value);
      if (value.status === 'AVAILABLE' || (retry && value.canRetry)) {
        const response = await fetch(endpoint, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value.request),
        });
        if (!response.ok) {
          const body: unknown = await response.json();
          throw new Error(
            body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
              ? body.error
              : 'Language help could not be prepared.'
          );
        }
        value = await read();
      }
      while (value.status === 'PENDING') {
        await pause(signal);
        value = await read();
      }
      if (
        value.status === 'READY' &&
        value.help?.workedExamples.length !== teaching.workedExamples.length
      )
        throw new Error('The saved help does not match this lesson.');
      if (!signal.aborted) setResult(value);
    } catch (failure) {
      if (!signal.aborted)
        setError(failure instanceof Error ? failure.message : 'Language help is unavailable.');
      else if (
        active.current === controller &&
        signal.reason instanceof Error &&
        signal.reason.name !== 'AbortError'
      )
        setError(signal.reason.message);
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) setBusy(false);
    }
  }

  const help = result?.status === 'READY' ? result.help : null;
  const nativeLabel = result ? getLanguageLabel(result.nativeLang) : null;
  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.openButton}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        Help in your language
      </button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <header className={styles.header}>
          <div>
            <p className={styles.label}>{nativeLabel ? `${nativeLabel} help` : 'Language help'}</p>
            <h2 id={titleId}>{teaching.title}</h2>
          </div>
          <button type="button" className={styles.closeButton} onClick={close}>
            Back to lesson
          </button>
        </header>
        {busy && (
          <div className={styles.status} role="status">
            <SottoSpinner label="Preparing your language help" />
          </div>
        )}
        {(error || result?.status === 'FAILED') && (
          <div className={styles.failure} role="alert">
            <p>{error || result?.error}</p>
            <button
              type="button"
              className={styles.openButton}
              disabled={busy}
              onClick={() => void load(Boolean(result?.canRetry))}
            >
              {result?.canRetry ? 'Retry language help' : 'Check saved status'}
            </button>
          </div>
        )}
        {help && result && (
          <div className={styles.content} lang={result.nativeLang}>
            <p className={styles.nativeTitle}>{help.title}</p>
            <section aria-label="Explanation in your language">
              {help.explanation.split(/\n\s*\n/).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </section>
            <section aria-label="Worked example meanings">
              <h3>Worked examples</h3>
              <ol className={styles.examples}>
                {teaching.workedExamples.map((example, index) => (
                  <li key={index}>
                    <p>{help.workedExamples[index].prompt}</p>
                    <p className={styles.target} lang={result.targetLang}>
                      {example.answer}
                    </p>
                    <p className={styles.meaning}>{help.workedExamples[index].meaning}</p>
                    <p>{help.workedExamples[index].explanation}</p>
                  </li>
                ))}
              </ol>
            </section>
            <section aria-label="Correction explanation in your language">
              <h3>Compare the sentences</h3>
              <p className={styles.incorrect} lang={result.targetLang}>
                {teaching.commonMistake.incorrect}
              </p>
              <p className={styles.target} lang={result.targetLang}>
                {teaching.commonMistake.correction}
              </p>
              <p>{help.correctionExplanation}</p>
            </section>
            <section aria-label="Practice guidance in your language">
              <h3>Try it first</h3>
              <p className={styles.target} lang={result.targetLang}>
                {teaching.guidedPractice.prompt}
              </p>
              <p>{help.guidedPrompt}</p>
              <p>{help.guidedHint}</p>
            </section>
          </div>
        )}
      </dialog>
    </div>
  );
}
