'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { classPrerequisiteResponseSchema, type ClassPrerequisiteResponse } from '@sotto/shared';
import styles from './ClassPrerequisite.module.css';
import type { ClassPrerequisiteDirections } from './prerequisiteTypes';

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
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

export function ClassPrerequisite({
  classId,
  sourceHash,
  onDirectionsChange,
}: {
  classId: string;
  sourceHash: string;
  onDirectionsChange?: (value: ClassPrerequisiteDirections | null) => void;
}) {
  return (
    <ClassPrerequisitePane
      key={JSON.stringify([classId, sourceHash])}
      classId={classId}
      sourceHash={sourceHash}
      onDirectionsChange={onDirectionsChange}
    />
  );
}

function ClassPrerequisitePane({
  classId,
  sourceHash,
  onDirectionsChange,
}: {
  classId: string;
  sourceHash: string;
  onDirectionsChange?: (value: ClassPrerequisiteDirections | null) => void;
}) {
  const title = useId();
  const active = useRef<AbortController | null>(null);
  const overCapacity = useRef(false);
  const [value, setValue] = useState<ClassPrerequisiteResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [capacityExceeded, setCapacityExceeded] = useState(false);
  const endpoint = `/api/v1/classes/${encodeURIComponent(classId)}/prerequisite`;

  const load = useCallback(
    async (prepare: boolean) => {
      if (overCapacity.current) return;
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      const signal = controller.signal;
      const timeout = setTimeout(
        () =>
          controller.abort(
            new Error('This is taking longer than expected. Check the saved status.')
          ),
        600_000
      );
      setBusy(true);
      setSaving(false);
      setError('');
      setValue(null);
      onDirectionsChange?.(null);
      const show = (current: ClassPrerequisiteResponse) => {
        if (signal.aborted) return;
        setValue(current);
        onDirectionsChange?.(
          current.status === 'READY' && current.content
            ? {
                classId,
                sourceHash,
                nativeLang: current.nativeLang,
                directions: current.content.directions,
              }
            : null
        );
      };
      const read = async (options?: RequestInit) => {
        const response = await fetch(endpoint, { ...options, signal, cache: 'no-store' });
        const body: unknown = await response.json();
        signal.throwIfAborted();
        if (response.status === 422) {
          overCapacity.current = true;
          setCapacityExceeded(true);
          throw new Error('This class is too large to prepare safely.');
        }
        if (!response.ok)
          throw new Error('Prerequisite teaching could not be loaded. Check its status.');
        const parsed = classPrerequisiteResponseSchema.safeParse(body);
        if (!parsed.success)
          throw new Error('Prerequisite teaching returned an incomplete response.');
        if (parsed.data.request.sourceHash !== sourceHash)
          throw new Error('The class changed. Reopen the class before viewing this explanation.');
        signal.throwIfAborted();
        return parsed.data;
      };
      try {
        let current = await read();
        show(current);
        if (
          prepare &&
          (current.status === 'AVAILABLE' ||
            (['FAILED', 'STALE'].includes(current.status) && current.canRetry))
        ) {
          current = await read({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(current.request),
          });
          show(current);
        }
        while (current.status === 'PENDING') {
          await pause(signal);
          current = current.recoverable
            ? await read({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(current.request),
              })
            : await read();
          show(current);
        }
      } catch (failure) {
        if (!signal.aborted)
          setError(
            failure instanceof Error ? failure.message : 'Prerequisite teaching is unavailable.'
          );
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
    },
    [classId, endpoint, onDirectionsChange, sourceHash]
  );

  const acknowledge = useCallback(async () => {
    if (value?.status !== 'READY' || value.acknowledged || !value.receiptId) return;
    const displayedReceipt = value.receiptId;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const signal = controller.signal;
    const timeout = setTimeout(
      () =>
        controller.abort(
          new Error('Saving is taking longer than expected. Check the saved status.')
        ),
      60_000
    );
    setBusy(true);
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${endpoint}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceHash, receiptId: displayedReceipt }),
        signal,
        cache: 'no-store',
      });
      const body: unknown = await response.json();
      signal.throwIfAborted();
      if (!response.ok) throw new Error('Could not save your place. Check the saved status.');
      const parsed = classPrerequisiteResponseSchema.safeParse(body);
      if (
        !parsed.success ||
        parsed.data.status !== 'READY' ||
        !parsed.data.acknowledged ||
        parsed.data.request.sourceHash !== sourceHash ||
        parsed.data.receiptId !== displayedReceipt
      )
        throw new Error('The explanation changed. Check the saved status.');
      setValue(parsed.data);
    } catch (failure) {
      if (!signal.aborted) {
        setValue(null);
        onDirectionsChange?.(null);
        setError(failure instanceof Error ? failure.message : 'Could not save your place.');
      } else if (
        active.current === controller &&
        signal.reason instanceof Error &&
        signal.reason.name !== 'AbortError'
      ) {
        setValue(null);
        onDirectionsChange?.(null);
        setError(signal.reason.message);
      }
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        setBusy(false);
        setSaving(false);
      }
    }
  }, [endpoint, onDirectionsChange, sourceHash, value]);

  useEffect(() => {
    const timer = setTimeout(() => void load(false), 0);
    const refresh = () => void load(false);
    window.addEventListener('focus', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      active.current?.abort();
    };
  }, [load]);

  if (!value && !busy && !error) return null;
  if (value?.status === 'UNAVAILABLE' && !error) return null;
  const canPrepare =
    value?.status === 'AVAILABLE' ||
    ((value?.status === 'FAILED' || value?.status === 'STALE') && value.canRetry);
  return (
    <section className={styles.root} aria-labelledby={title}>
      <div className={styles.heading}>
        <p className={styles.label}>Before you practise</p>
        <h2 id={title}>Build the basics</h2>
      </div>
      {busy && (
        <p className={styles.status} role="status">
          {saving
            ? 'Saving your place…'
            : value?.status === 'PENDING'
              ? 'Preparing your explanation…'
              : 'Checking your lesson…'}
        </p>
      )}
      {error && (
        <div className={styles.message} role="alert">
          <p>{error}</p>
          {!capacityExceeded && (
            <button type="button" onClick={() => void load(false)}>
              Check saved status
            </button>
          )}
        </div>
      )}
      {!error && value?.status === 'UNRESOLVED' && (
        <p className={styles.message} role="alert">
          This request needs recovery on the server before it can be tried again.
        </p>
      )}
      {!error && value?.status === 'FAILED' && (
        <p className={styles.message} role="alert">
          {value.failure === 'UNSAFE'
            ? 'This explanation could not be prepared safely. Your existing lesson is still available.'
            : 'The explanation could not be prepared.'}
        </p>
      )}
      {!error && value?.status === 'STALE' && (
        <p className={styles.message}>
          The class changed, so its earlier explanation is no longer shown.
        </p>
      )}
      {!error && value?.status === 'AVAILABLE' && (
        <p className={styles.intro}>
          Get an explanation of the ideas you need before the exercises. This uses your configured
          AI provider and may take several minutes.
        </p>
      )}
      {!error && canPrepare && (
        <button
          className={styles.action}
          type="button"
          disabled={busy}
          onClick={() => void load(true)}
        >
          {value?.status === 'AVAILABLE' ? 'Explain the basics' : 'Prepare a new explanation'}
        </button>
      )}
      {!error && value?.status === 'READY' && value.content && (
        <div className={styles.content} lang={value.nativeLang}>
          <h3>{value.content.title}</h3>
          <div className={styles.explanation}>
            {value.content.explanation.split(/\n\s*\n/).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
          <ol className={styles.examples}>
            {value.content.examples.map((example, index) => (
              <li key={index}>
                <p className={styles.target} lang={value.targetLang}>
                  {example.target}
                </p>
                <p className={styles.meaning}>{example.meaning}</p>
                <p>{example.explanation}</p>
              </li>
            ))}
          </ol>
          {!value.acknowledged && (
            <button
              className={styles.action}
              type="button"
              disabled={busy}
              onClick={() => void acknowledge()}
            >
              Mark basics as read
            </button>
          )}
          {value.acknowledged && <p role="status">Basics marked as read.</p>}
        </div>
      )}
    </section>
  );
}
