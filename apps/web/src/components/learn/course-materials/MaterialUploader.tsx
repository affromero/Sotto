'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod';
import { materialUploadLimits } from '@sotto/shared';
import {
  createMaterialUploadClientState,
  uploadMaterialFiles,
  validateMaterialUploadReceipt,
  type MaterialUploadClientState,
} from '@/lib/course-materials/client/uploads';
import {
  readBrowserUploadCheckpoint,
  saveBrowserUploadCheckpoint,
  clearBrowserUploadCheckpoint,
} from '@/lib/course-materials/client/browser-checkpoint';
import styles from './MaterialUploader.module.css';

const profileSchema = z.object({ id: z.string().min(1) });
interface Props {
  courseId: string;
  onComplete: () => void | Promise<void>;
}

async function activeProfile(signal: AbortSignal) {
  const response = await fetch('/api/v1/users/me', {
    signal,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Sign in to the learner profile before uploading.');
  return profileSchema.parse(await response.json()).id;
}

export function MaterialUploader(props: Props) {
  return <CourseMaterialUploader key={props.courseId} {...props} />;
}

function CourseMaterialUploader({ courseId, onComplete }: Props) {
  const id = useId();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [state, setState] = useState<MaterialUploadClientState | null>(null);
  const saved = useRef<MaterialUploadClientState | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const scope = `course:${courseId}`;

  useEffect(() => {
    const current = new AbortController();
    void (async () => {
      try {
        const profile = await activeProfile(current.signal);
        const checkpoint = readBrowserUploadCheckpoint(profile, scope);
        current.signal.throwIfAborted();
        if (checkpoint && checkpoint.courseId !== courseId)
          throw new Error('Saved upload progress does not belong to this course.');
        saved.current = checkpoint;
        setState(checkpoint);
        setProfileId(profile);
        setReady(true);
      } catch (cause) {
        if (!current.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : 'Could not read saved upload progress.'
          );
      }
    })();
    return () => {
      current.abort();
      controller.current?.abort();
    };
  }, [courseId, scope]);

  async function upload() {
    if (!profileId || !files.length || controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setMessage('Checking learner and saved upload progress.');
    setError('');
    try {
      if ((await activeProfile(current.signal)) !== profileId)
        throw new Error('The active learner changed. Reopen this course before uploading.');
      current.signal.throwIfAborted();
      let checkpoint = saved.current;
      if (checkpoint) {
        if (
          checkpoint.request.files.length !== files.length ||
          checkpoint.request.files.some(
            (file, index) =>
              file.name !== files[index].name ||
              file.byteSize !== files[index].size ||
              file.mimeType !== (files[index].type || 'application/octet-stream')
          )
        )
          throw new Error(
            'Select the same files in the same order to resume. Uploaded chunks will be checked against their saved checksums.'
          );
      } else {
        checkpoint = createMaterialUploadClientState(
          files.map((file) => ({ clientId: crypto.randomUUID(), file })),
          { courseId, expectedProfileId: profileId }
        );
      }
      const persist = (value: MaterialUploadClientState) => {
        current.signal.throwIfAborted();
        saveBrowserUploadCheckpoint(profileId, scope, value);
        saved.current = value;
        setState(value);
      };
      persist(checkpoint);
      await uploadMaterialFiles({
        files: files.map((file, index) => ({
          clientId: checkpoint.request.files[index].clientId,
          file,
        })),
        state: checkpoint,
        signal: current.signal,
        deadlineAt: Date.now() + 7_200_000,
        onState: persist,
        onProgress: (progress) => {
          if (!current.signal.aborted)
            setMessage(
              `${progress.phase.toLowerCase()}: ${(progress.batchUploadedBytes / 1_048_576).toFixed(1)} of ${(progress.batchBytes / 1_048_576).toFixed(1)} MiB`
            );
        },
      });
      current.signal.throwIfAborted();
      clearBrowserUploadCheckpoint(profileId, scope);
      saved.current = null;
      setState(null);
      setFiles([]);
      setMessage('Original files saved. Page processing continues in the background.');
      await onComplete();
    } catch (cause) {
      if (!current.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : 'Upload stopped. Resume from its saved progress.'
        );
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  async function cancelSaved() {
    if (!profileId || !saved.current?.batch || controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError('');
    try {
      if ((await activeProfile(current.signal)) !== profileId)
        throw new Error('The active learner changed. Reopen this course before cancelling.');
      for (const upload of saved.current.batch.uploads) {
        const url = `/api/v1/materials/uploads/${upload.uploadId}`;
        const headers = { 'x-sotto-expected-profile-id': profileId };
        const read = await fetch(url, {
          signal: current.signal,
          cache: 'no-store',
          headers,
        });
        if (!read.ok)
          throw new Error('Could not check a saved upload. Its progress remains retained.');
        const status = validateMaterialUploadReceipt(await read.json(), upload);
        if (status.status === 'COMPLETE') continue;
        const response = await fetch(url, {
          method: 'DELETE',
          signal: current.signal,
          headers,
        });
        if (!response.ok)
          throw new Error('Upload cleanup is not confirmed. Its saved progress remains retained.');
        const cancelled = validateMaterialUploadReceipt(await response.json(), status);
        if (!['CANCELLED', 'EXPIRED'].includes(cancelled.status))
          throw new Error(
            'Upload cancellation is still pending. Check it again before starting a replacement.'
          );
      }
      current.signal.throwIfAborted();
      clearBrowserUploadCheckpoint(profileId, scope);
      saved.current = null;
      setState(null);
      setFiles([]);
      setMessage('Unfinished uploads cancelled. Saved originals remain available.');
      await onComplete();
    } catch (cause) {
      if (!current.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : 'Could not confirm saved upload cancellation.'
        );
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <section className={styles.root} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>Upload course materials</h3>
      <p>
        Up to {materialUploadLimits.maxFiles} files, {materialUploadLimits.maxFileBytes / 1_048_576}{' '}
        MiB each. Originals and every source page are retained.
      </p>
      {state && (
        <div className={styles.saved} role="status">
          <p>
            Saved upload available. Select these original files in the same order to resume after
            closing this page.
          </p>
          <ol>
            {state.request.files.map((file) => (
              <li key={file.clientId}>
                {file.name} ({(file.byteSize / 1_048_576).toFixed(1)} MiB)
              </li>
            ))}
          </ol>
        </div>
      )}
      <label className={styles.field} htmlFor={`${id}-files`}>
        Choose original files
      </label>
      <input
        id={`${id}-files`}
        type="file"
        multiple
        disabled={!ready || busy}
        onChange={(event) => {
          setFiles(Array.from(event.target.files ?? []));
          setError('');
        }}
        accept=".pdf,.txt,.md,.csv,.docx,.pptx,.xlsx,.epub,.html,.json,.rtf,text/*,application/pdf"
      />
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={!ready || busy || !files.length}
          onClick={() => void upload()}
        >
          {busy ? 'Uploading...' : state ? 'Resume saved upload' : 'Upload originals'}
        </button>
        {busy && (
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              controller.current?.abort();
              setMessage('Waiting stopped. The saved upload can be resumed.');
            }}
          >
            Stop waiting
          </button>
        )}
        {state?.batch && !busy && (
          <button type="button" className={styles.secondary} onClick={() => void cancelSaved()}>
            Cancel unfinished uploads
          </button>
        )}
      </div>
      {message && (
        <p role="status" aria-live="polite">
          {message}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
