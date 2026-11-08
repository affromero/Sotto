'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { classAssessmentSpeakingStatusSchema } from '@sotto/shared';
import { useAudioRecorder } from '@/lib/hooks/useAudioRecorder';

const retainedSchema = z
  .object({ requestId: z.uuid(), data: z.string().startsWith('data:') })
  .strict();
type Status = z.infer<typeof classAssessmentSpeakingStatusSchema>;
type Retained = z.infer<typeof retainedSchema>;

function encode(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The recording could not be saved locally.'));
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('The recording could not be saved locally.'));
    reader.readAsDataURL(blob);
  });
}

function decode(data: string): Blob {
  const match = /^data:([^,]*);base64,([A-Za-z0-9+/]*={0,2})$/.exec(data);
  if (!match) throw new Error('The saved recording is invalid.');
  const binary = atob(match[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1] });
}

export function AssessmentSpeakingPrompt({
  task,
  url,
  storageKey,
  ownerId,
  disabled,
  suspended,
  recoveryOnly,
  onStatus,
  onHeld,
}: {
  task: string;
  url: string;
  storageKey: string;
  ownerId: string;
  disabled: boolean;
  suspended: boolean;
  recoveryOnly: boolean;
  onStatus: (complete: boolean) => void;
  onHeld: (held: boolean) => void;
}) {
  const recorder = useAudioRecorder({ maxSeconds: 60, minSeconds: 2 });
  const resetRecording = recorder.reset;
  const stopRecording = recorder.stopRecording;
  const isRecording = recorder.isRecording;
  const [status, setStatus] = useState<Status | null>(null);
  const [retained, setRetained] = useState<Retained | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const live = useRef<AbortController | null>(null);
  const retainedRef = useRef<Retained | null>(null);
  const inFlight = useRef(false);
  const statusCallback = useRef(onStatus);
  const heldCallback = useRef(onHeld);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    statusCallback.current = onStatus;
    heldCallback.current = onHeld;
    disabledRef.current = disabled;
  }, [onStatus, onHeld, disabled]);

  const activeOwner = useCallback(
    async (signal: AbortSignal) => {
      const response = await fetch('/api/v1/users/me', { signal, cache: 'no-store' });
      if (!response.ok || z.object({ id: z.string() }).parse(await response.json()).id !== ownerId)
        throw new Error('The active profile changed.');
    },
    [ownerId]
  );

  const check = useCallback(
    async (signal: AbortSignal) => {
      await activeOwner(signal);
      const response = await fetch(url, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Speaking status could not be checked.');
      const next = classAssessmentSpeakingStatusSchema.parse(await response.json());
      await activeOwner(signal);
      if (signal.aborted) return;
      const local = retainedRef.current;
      if (local && 'requestId' in next && next.requestId === local.requestId) {
        const saved = sessionStorage.getItem(storageKey);
        if (saved === JSON.stringify(local)) {
          sessionStorage.removeItem(storageKey);
          retainedRef.current = null;
          setRetained(null);
          resetRecording();
        }
      }
      setStatus(next);
      statusCallback.current(next.status === 'COMPLETED' && !retainedRef.current);
      setError('');
    },
    [activeOwner, resetRecording, storageKey, url]
  );

  useEffect(() => {
    const controller = new AbortController();
    live.current = controller;
    statusCallback.current(false);
    try {
      const saved = sessionStorage.getItem(storageKey);
      const parsed = saved ? retainedSchema.parse(JSON.parse(saved)) : null;
      retainedRef.current = parsed;
      queueMicrotask(() => {
        if (!controller.signal.aborted) setRetained(parsed);
      });
      queueMicrotask(() => {
        if (controller.signal.aborted) return;
        void check(controller.signal).catch(() => {
          if (!controller.signal.aborted) {
            setStatus(null);
            statusCallback.current(false);
            setError('Speaking status could not be checked.');
          }
        });
      });
    } catch {
      queueMicrotask(() => {
        if (!controller.signal.aborted)
          setError('The saved recording could not be read. Keep this page open.');
      });
    }
    return () => {
      controller.abort();
      statusCallback.current(false);
    };
  }, [check, storageKey]);

  useEffect(() => {
    heldCallback.current(Boolean(recorder.isRecording || recorder.recordedBlob || retained));
    return () => heldCallback.current(false);
  }, [recorder.isRecording, recorder.recordedBlob, retained]);

  useEffect(() => {
    if (suspended && isRecording) stopRecording();
  }, [suspended, isRecording, stopRecording]);

  useEffect(() => {
    if (status?.status !== 'RUNNING') return;
    const timer = window.setTimeout(() => {
      if (live.current)
        void check(live.current.signal).catch(() => {
          if (live.current?.signal.aborted) return;
          setStatus(null);
          statusCallback.current(false);
          setError('Speaking status could not be checked.');
        });
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [check, status]);

  async function send(local: Retained, signal: AbortSignal) {
    await activeOwner(signal);
    const blob = decode(local.data);
    await activeOwner(signal);
    const form = new FormData();
    form.append('requestId', local.requestId);
    form.append('audio', blob, 'recording');
    const response = await fetch(url, { method: 'POST', body: form, signal });
    if (!response.ok)
      throw new Error(
        'The recording may not have been saved. Check its status or retry this recording.'
      );
    await check(signal);
  }

  async function save() {
    const signal = live.current?.signal;
    if (!signal || inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true);
    try {
      let local = retainedRef.current;
      if (!local) {
        if (!recorder.recordedBlob) return;
        await activeOwner(signal);
        local = { requestId: crypto.randomUUID(), data: await encode(recorder.recordedBlob) };
        await activeOwner(signal);
        if (signal.aborted) return;
        if (sessionStorage.getItem(storageKey))
          throw new Error('Another recording is already waiting to be sent.');
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(local));
        } catch {
          throw new Error(
            'This browser could not retain your recording. Download it or free storage before retrying.'
          );
        }
        retainedRef.current = local;
        setRetained(local);
      }
      await send(local, signal);
    } catch (cause) {
      if (!signal.aborted)
        setError(cause instanceof Error ? cause.message : 'The recording could not be saved.');
    } finally {
      inFlight.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  async function discardLocal() {
    const signal = live.current?.signal;
    const local = retainedRef.current;
    if (!signal || !local) return;
    try {
      await activeOwner(signal);
      if (signal.aborted || sessionStorage.getItem(storageKey) !== JSON.stringify(local)) return;
      sessionStorage.removeItem(storageKey);
      retainedRef.current = null;
      setRetained(null);
      resetRecording();
      statusCallback.current(status?.status === 'COMPLETED');
    } catch {
      if (!signal.aborted) setError('The local recording could not be discarded.');
    }
  }

  const canRecord =
    !disabled &&
    !busy &&
    !retained &&
    (status?.status === 'NOT_STARTED' || status?.status === 'FAILED');
  return (
    <div>
      {!recoveryOnly && <p>{task}</p>}
      {error && <p role="alert">{error}</p>}
      {recorder.error && <p role="alert">{recorder.error}</p>}
      {!status && !error && <p role="status">Checking speaking status…</p>}
      {status?.status === 'RUNNING' && <p role="status">Checking your recording…</p>}
      {status?.status === 'COMPLETED' && <p role="status">Recording saved.</p>}
      {status?.status === 'UNRESOLVED' && (
        <p role="status">Your recording needs recovery before continuing.</p>
      )}
      {status?.status === 'FAILED' && <p>Grading could not start. You can record again.</p>}
      {recorder.isRecording ? (
        <button type="button" onClick={recorder.stopRecording}>
          Stop recording
        </button>
      ) : canRecord && !recorder.recordedBlob ? (
        <button
          type="button"
          onClick={() =>
            void recorder.startRecording(() =>
              Boolean(live.current && !live.current.signal.aborted && !disabledRef.current)
            )
          }
        >
          Record
        </button>
      ) : null}
      {recorder.recordedBlob && canRecord && (
        <button type="button" onClick={() => void save()}>
          Save recording
        </button>
      )}
      {retained && (
        <button type="button" disabled={disabled || busy} onClick={() => void save()}>
          Retry this recording
        </button>
      )}
      {retained && status && 'requestId' in status && status.requestId !== retained.requestId && (
        <div>
          <p>
            A different recording is saved for this task. Download your local recording if you want
            to keep it.
          </p>
        </div>
      )}
      {retained && (
        <button type="button" disabled={busy} onClick={() => void discardLocal()}>
          Discard local recording
        </button>
      )}
      {!retained && recorder.recordedBlob && (
        <button type="button" disabled={busy} onClick={resetRecording}>
          Discard recording
        </button>
      )}
      {error && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            live.current &&
            void check(live.current.signal).catch(() => {
              if (live.current?.signal.aborted) return;
              setStatus(null);
              statusCallback.current(false);
              setError('Speaking status could not be checked.');
            })
          }
        >
          Check speaking status
        </button>
      )}
      {(retained || recorder.recordedBlob) && (
        <a
          href={retained?.data ?? '#'}
          onClick={
            retained
              ? undefined
              : (event) => {
                  if (!recorder.recordedBlob) return;
                  const url = URL.createObjectURL(recorder.recordedBlob);
                  event.currentTarget.href = url;
                  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
                }
          }
          download="assessment-recording"
        >
          Download recording
        </a>
      )}
    </div>
  );
}
