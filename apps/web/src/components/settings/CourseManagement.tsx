'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { langLabel } from '@/lib/languages';
import styles from './CourseManagement.module.css';

export interface ManagedCourse {
  id: string;
  nativeLang: string;
  targetLang: string;
  currentLevel: string;
  title: string;
}

type DialogMode = 'reset' | 'remove';

interface GraphNode {
  kind: string;
}

interface DialogState {
  course: ManagedCourse;
  mode: DialogMode;
  counts: { vocab: number; grammar: number } | null;
  confirmText: string;
  busy: boolean;
  error: string;
}

/** Trigger a client-side file download of a JSON blob. */
function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Per-course management: export the memory graph, reset a course to restart the
 * same language at a different level, or remove a language entirely. Reset and
 * remove both permanently delete everything tied to the course, so each goes
 * through a type-to-confirm dialog that surfaces what will be lost.
 */
export function CourseManagement({ courses }: { courses: ManagedCourse[] }) {
  const router = useRouter();
  const [list, setList] = useState(courses);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  async function exportVocab(course: ManagedCourse): Promise<void> {
    setExportingId(course.id);
    try {
      const res = await fetch(`/api/v1/courses/${course.id}/graph`);
      if (res.ok) {
        const graph = await res.json();
        downloadJson(`${course.targetLang}-from-${course.nativeLang}-memory-graph.json`, graph);
      }
    } catch {
      // Export is best-effort; nothing destructive happens here.
    } finally {
      setExportingId(null);
    }
  }

  async function openDialog(course: ManagedCourse, mode: DialogMode): Promise<void> {
    setDialog({ course, mode, counts: null, confirmText: '', busy: false, error: '' });
    try {
      const res = await fetch(`/api/v1/courses/${course.id}/graph`);
      if (res.ok) {
        const graph = await res.json();
        const nodes: GraphNode[] = Array.isArray(graph.nodes) ? graph.nodes : [];
        const counts = {
          vocab: nodes.filter((n) => n.kind === 'vocab').length,
          grammar: nodes.filter((n) => n.kind === 'grammar').length,
        };
        setDialog((d) => (d && d.course.id === course.id ? { ...d, counts } : d));
      }
    } catch {
      // The counts are a nicety; the dialog still works without them.
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!dialog) return;
    const { course, mode, confirmText } = dialog;
    if (confirmText.trim().toLowerCase() !== course.targetLang.toLowerCase()) return;

    setDialog({ ...dialog, busy: true, error: '' });
    try {
      const res = await fetch(`/api/v1/courses/${course.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: course.targetLang }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDialog((d) =>
          d ? { ...d, busy: false, error: body.error ?? 'Could not delete the course.' } : d
        );
        return;
      }
      setList((cur) => cur.filter((c) => c.id !== course.id));
      setDialog(null);
      if (mode === 'reset') {
        router.push(`/learn/placement?native=${course.nativeLang}&target=${course.targetLang}`);
      } else {
        router.refresh();
      }
    } catch {
      setDialog((d) =>
        d ? { ...d, busy: false, error: 'A network error occurred. Please try again.' } : d
      );
    }
  }

  if (list.length === 0) {
    return (
      <section className={styles.section} aria-labelledby="course-mgmt-heading">
        <h2 id="course-mgmt-heading" className={styles.heading}>
          Manage courses
        </h2>
        <p className={styles.empty}>You have no courses yet.</p>
      </section>
    );
  }

  const confirmMatches =
    dialog != null &&
    dialog.confirmText.trim().toLowerCase() === dialog.course.targetLang.toLowerCase();

  return (
    <section className={styles.section} aria-labelledby="course-mgmt-heading">
      <h2 id="course-mgmt-heading" className={styles.heading}>
        Manage courses
      </h2>
      <p className={styles.intro}>
        Restart a language at a different level, remove one you no longer want, or export your
        vocabulary. Resetting and removing are permanent.
      </p>

      <ul className={styles.list} role="list">
        {list.map((course) => (
          <li key={course.id} className={styles.row}>
            <div className={styles.rowInfo}>
              <span className={styles.rowTitle}>
                {course.title || langLabel(course.targetLang)}
              </span>
              <span className={styles.rowMeta}>
                {langLabel(course.targetLang)} · {course.currentLevel}
              </span>
            </div>
            <div className={styles.rowActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => void exportVocab(course)}
                disabled={exportingId === course.id}
              >
                {exportingId === course.id ? 'Exporting…' : 'Export vocab'}
              </button>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => void openDialog(course, 'reset')}
              >
                Reset &amp; restart
              </button>
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() => void openDialog(course, 'remove')}
              >
                Remove language
              </button>
            </div>
          </li>
        ))}
      </ul>

      {dialog && (
        <div
          className={styles.overlay}
          role="presentation"
          onClick={() => !dialog.busy && setDialog(null)}
        >
          <div
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="course-mgmt-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="course-mgmt-dialog-title" className={styles.dialogTitle}>
              {dialog.mode === 'reset' ? 'Reset & restart' : 'Remove'}{' '}
              {langLabel(dialog.course.targetLang)}
            </h3>
            <p className={styles.dialogBody}>
              This permanently deletes{' '}
              {dialog.counts
                ? `${dialog.counts.vocab} tracked words and ${dialog.counts.grammar} grammar points`
                : 'your vocabulary and grammar progress'}
              , plus all classes, exams, practice history, generated audio, and any class in
              progress.
              {dialog.mode === 'reset'
                ? ' You will then place into this language again from scratch.'
                : ' This cannot be undone.'}
            </p>

            <button
              type="button"
              className={styles.exportInline}
              onClick={() => void exportVocab(dialog.course)}
              disabled={exportingId === dialog.course.id}
            >
              Export your vocabulary first
            </button>

            <label className={styles.confirmLabel} htmlFor="course-mgmt-confirm">
              Type the language code <code>{dialog.course.targetLang}</code> to confirm
            </label>
            <input
              id="course-mgmt-confirm"
              className={styles.confirmInput}
              value={dialog.confirmText}
              autoComplete="off"
              onChange={(e) => setDialog((d) => (d ? { ...d, confirmText: e.target.value } : d))}
            />

            {dialog.error && (
              <p className={styles.dialogError} role="alert">
                {dialog.error}
              </p>
            )}

            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setDialog(null)}
                disabled={dialog.busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() => void confirmDelete()}
                disabled={!confirmMatches || dialog.busy}
                aria-disabled={!confirmMatches || dialog.busy}
              >
                {dialog.busy
                  ? 'Deleting…'
                  : dialog.mode === 'reset'
                    ? 'Delete & restart'
                    : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
