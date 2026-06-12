'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './CourseNotesPanel.module.css';

const MAX_NOTE_LENGTH = 12000;

interface CourseNotesPanelProps {
  courseId: string;
}

interface NotesResponse {
  body?: string;
  addedVocabulary?: number;
  imported?: number;
  failed?: number;
  error?: string;
}

type Phase = 'idle' | 'loading' | 'saving' | 'importing';

function statusText(data: NotesResponse, fallback: string): string {
  const added = data.addedVocabulary ?? 0;
  const imported = data.imported ?? 0;
  const failed = data.failed ?? 0;

  if (imported > 0) {
    const failText = failed > 0 ? ` · ${failed} failed` : '';
    return `Imported ${imported} file${imported === 1 ? '' : 's'} · ${added} vocab added${failText}`;
  }

  return added > 0 ? `${fallback} · ${added} vocab added` : fallback;
}

export function CourseNotesPanel({ courseId }: CourseNotesPanelProps) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [body, setBody] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || loaded) return;

    let cancelled = false;
    setPhase('loading');
    setError('');

    void (async () => {
      try {
        const res = await fetch(`/api/v1/courses/${courseId}/notes`, { credentials: 'include' });
        const data = (await res.json().catch(() => ({}))) as NotesResponse;
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? 'Could not load course notes.');
          return;
        }
        setBody(data.body ?? '');
        setLoaded(true);
      } catch {
        if (!cancelled) setError('Could not load course notes.');
      } finally {
        if (!cancelled) setPhase('idle');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [courseId, loaded, open]);

  async function saveNotes() {
    setPhase('saving');
    setError('');
    setMessage('');

    try {
      const res = await fetch(`/api/v1/courses/${courseId}/notes`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = (await res.json().catch(() => ({}))) as NotesResponse;
      if (!res.ok) {
        setError(data.error ?? 'Could not save course notes.');
        return;
      }
      setBody(data.body ?? '');
      setMessage(statusText(data, 'Saved'));
    } catch {
      setError('Could not save course notes.');
    } finally {
      setPhase('idle');
    }
  }

  async function importFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    setPhase('importing');
    setError('');
    setMessage('');

    const form = new FormData();
    Array.from(files).forEach((file) => form.append('files', file));

    try {
      const res = await fetch(`/api/v1/courses/${courseId}/notes`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as NotesResponse;
      if (!res.ok) {
        setError(data.error ?? 'Could not import those notes.');
        return;
      }
      setBody(data.body ?? '');
      setLoaded(true);
      setMessage(statusText(data, 'Imported'));
    } catch {
      setError('Could not import those notes.');
    } finally {
      setPhase('idle');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const busy = phase !== 'idle';
  const remaining = Math.max(0, MAX_NOTE_LENGTH - body.length);

  if (!open) {
    return (
      <button
        type="button"
        className={styles.opener}
        onClick={() => setOpen(true)}
        aria-expanded={false}
      >
        <span className={styles.openerLede}>Course notes</span>
        <span className={styles.openerHint}>official notes, vocab, level fit</span>
      </button>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>Course notes</span>
        <button
          type="button"
          className={styles.close}
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Close
        </button>
      </div>

      <label className={styles.fieldLabel} htmlFor={`course-notes-${courseId}`}>
        Paste notes from an official course
      </label>
      <textarea
        id={`course-notes-${courseId}`}
        className={styles.textarea}
        value={body}
        maxLength={MAX_NOTE_LENGTH}
        disabled={phase === 'loading'}
        onChange={(event) => setBody(event.currentTarget.value)}
        placeholder="Grammar points, vocabulary lists, textbook chapter notes..."
      />
      <div className={styles.metaRow}>
        <span>{remaining.toLocaleString()} chars left</span>
        {phase === 'loading' ? <span>Loading...</span> : null}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        >
          {phase === 'importing' ? 'Importing...' : 'Upload notes'}
        </button>
        <button
          type="button"
          className={styles.primary}
          onClick={() => void saveNotes()}
          disabled={busy}
        >
          {phase === 'saving' ? 'Saving...' : 'Save notes'}
        </button>
        <input
          ref={fileInputRef}
          className={styles.fileInput}
          type="file"
          multiple
          accept=".csv,.docx,.epub,.html,.json,.log,.markdown,.md,.mdx,.pdf,.pptx,.rtf,.text,.tsv,.txt,.xlsx,.xml,.yaml,.yml,application/pdf,text/*"
          onChange={(event) => void importFiles(event.currentTarget.files)}
          aria-label="Upload course note files"
        />
      </div>

      {message ? (
        <p className={styles.status} role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
