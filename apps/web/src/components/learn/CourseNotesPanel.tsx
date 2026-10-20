'use client';

import { useEffect, useRef, useState } from 'react';
import { courseNotesPageSchema } from '@sotto/shared';
import Link from 'next/link';
import styles from './CourseNotesPanel.module.css';
import { MaterialUploader } from './course-materials/MaterialUploader';
import { CourseAnalysisPanel } from './course-materials/CourseAnalysisPanel';
import { MaterialProcessingPanel } from '@/components/course-materials/MaterialProcessingPanel';
import { LegacyMaterialText } from './course-materials/LegacyMaterialText';

const MAX_NOTE_LENGTH = 12000;

interface CourseNotesPanelProps {
  courseId: string;
  nativeLang: string;
  targetLang: string;
}

interface NotesResponse {
  body?: string;
  addedVocabulary?: number;
  imported?: number;
  vocabularyIndexing?: 'queued';
  failed?: number;
  error?: string;
}

type NotesPage = ReturnType<typeof courseNotesPageSchema.parse>;

type Phase = 'idle' | 'loading' | 'saving';

async function readInventory(courseId: string, current: AbortController, after?: string) {
  const query = after ? `?${new URLSearchParams({ after })}` : '';
  const response = await fetch(`/api/v1/courses/${encodeURIComponent(courseId)}/notes${query}`, {
    credentials: 'include',
    cache: 'no-store',
    signal: current.signal,
  });
  const result: unknown = await response.json();
  if (!response.ok) throw new Error('Could not read retained materials.');
  const parsed = courseNotesPageSchema.safeParse(result);
  if (!parsed.success) throw new Error('The retained material list is invalid. Reopen the course.');
  return parsed.data;
}

function statusText(data: NotesResponse, fallback: string): string {
  const added = data.addedVocabulary ?? 0;
  const imported = data.imported ?? 0;
  const failed = data.failed ?? 0;

  if (imported > 0) {
    const failText = failed > 0 ? ` · ${failed} failed` : '';
    return data.vocabularyIndexing === 'queued'
      ? `Imported ${imported} file${imported === 1 ? '' : 's'}. Vocabulary indexing is queued.${failText}`
      : `Imported ${imported} file${imported === 1 ? '' : 's'} · ${added} vocab added${failText}`;
  }

  return added > 0 ? `${fallback} · ${added} vocab added` : fallback;
}

export function CourseNotesPanel(props: CourseNotesPanelProps) {
  return <CourseNotesEditor key={props.courseId} {...props} />;
}

function CourseNotesEditor({ courseId, nativeLang, targetLang }: CourseNotesPanelProps) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [body, setBody] = useState('');
  const [materials, setMaterials] = useState<NotesPage['materials']>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [materialBusy, setMaterialBusy] = useState(false);
  const [materialError, setMaterialError] = useState('');
  const inventory = useRef<AbortController | null>(null);
  const seenCursors = useRef(new Set<string>());
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => () => inventory.current?.abort(), []);

  useEffect(() => {
    if (!open || loaded) return;

    const current = new AbortController();
    inventory.current?.abort();
    inventory.current = current;

    void (async () => {
      try {
        const data = await readInventory(courseId, current);
        if (current.signal.aborted || inventory.current !== current) return;
        setBody(data.body);
        setMaterials(data.materials);
        setNextCursor(data.nextCursor);
        seenCursors.current = new Set(data.nextCursor ? [data.nextCursor] : []);
        setLoaded(true);
      } catch (cause) {
        if (!current.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Could not load course notes.');
      } finally {
        if (!current.signal.aborted) setPhase('idle');
      }
    })();

    return () => {
      current.abort();
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

  async function reloadMaterials() {
    inventory.current?.abort();
    const current = new AbortController();
    inventory.current = current;
    setMaterialBusy(true);
    setMaterialError('');
    try {
      const result = await readInventory(courseId, current);
      if (current.signal.aborted || inventory.current !== current) return;
      setMaterials(result.materials);
      setNextCursor(result.nextCursor);
      seenCursors.current = new Set(result.nextCursor ? [result.nextCursor] : []);
    } finally {
      if (!current.signal.aborted) setMaterialBusy(false);
    }
  }

  async function moreMaterials() {
    if (materialBusy || !nextCursor) return;
    const after = nextCursor;
    const current = new AbortController();
    inventory.current?.abort();
    inventory.current = current;
    setMaterialBusy(true);
    setMaterialError('');
    try {
      const result = await readInventory(courseId, current, after);
      if (current.signal.aborted || inventory.current !== current) return;
      if (result.nextCursor && seenCursors.current.has(result.nextCursor))
        throw new Error(
          'The material cursor did not advance. Refresh the course before continuing.'
        );
      setMaterials((existing) => {
        const ids = new Set(existing.map((material) => material.id));
        return [...existing, ...result.materials.filter((material) => !ids.has(material.id))];
      });
      setNextCursor(result.nextCursor);
      if (result.nextCursor) seenCursors.current.add(result.nextCursor);
    } catch (cause) {
      if (!current.signal.aborted)
        setMaterialError(cause instanceof Error ? cause.message : 'Could not read more materials.');
    } finally {
      if (!current.signal.aborted) setMaterialBusy(false);
    }
  }

  const busy = phase !== 'idle';
  const remaining = Math.max(0, MAX_NOTE_LENGTH - body.length);

  if (!open) {
    return (
      <button
        type="button"
        className={styles.opener}
        onClick={() => {
          if (!loaded) {
            setPhase('loading');
            setError('');
          }
          setOpen(true);
        }}
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
      {materials.length > 0 && (
        <div>
          <Link href={`/learn/vocabulary?course=${courseId}`}>
            View vocabulary and import progress
          </Link>
          <ul className={styles.materials} aria-label="Uploaded materials">
            {materials.map((material) => (
              <li key={material.id}>
                <a
                  className={styles.materialLink}
                  href={`/api/v1/materials/${encodeURIComponent(material.id)}/file`}
                >
                  {material.name}
                </a>
                {material.legacyTextUrl && (
                  <LegacyMaterialText materialId={material.id} url={material.legacyTextUrl} />
                )}
                <MaterialProcessingPanel
                  materialId={material.id}
                  name={material.name}
                  mimeType={material.mimeType}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {nextCursor && (
        <button
          type="button"
          className={styles.secondary}
          disabled={materialBusy}
          onClick={() => void moreMaterials()}
        >
          {materialBusy ? 'Reading more materials...' : 'Load more materials'}
        </button>
      )}
      {materialError && (
        <p className={styles.error} role="alert">
          {materialError}
        </p>
      )}
      <p>
        These notes guide future preparation. Your practice results determine mastery. Clearing and
        saving the notes does not remove vocabulary already imported or change your scores. Uploaded
        documents are kept separately from these editable notes.
      </p>
      <textarea
        id={`course-notes-${courseId}`}
        className={styles.textarea}
        value={body}
        maxLength={MAX_NOTE_LENGTH}
        disabled={busy}
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
          className={styles.primary}
          onClick={() => void saveNotes()}
          disabled={busy}
        >
          {phase === 'saving' ? 'Saving...' : 'Save notes'}
        </button>
      </div>
      {loaded && <MaterialUploader courseId={courseId} onComplete={reloadMaterials} />}
      <CourseAnalysisPanel
        courseId={courseId}
        nativeLang={nativeLang}
        targetLang={targetLang}
        materials={materials}
      />

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
