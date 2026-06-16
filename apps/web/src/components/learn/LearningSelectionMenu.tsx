'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { BookmarkPlus, Dumbbell, ImagePlus, Volume2, X } from 'lucide-react';
import type { FocusTargetSource } from '@sotto/shared';
import styles from './LearningSelectionMenu.module.css';

interface LearningTargetResponse {
  id: string;
  text: string;
  visualCueUrl: string | null;
  visualCueAlt: string | null;
  pronunciationAudioUrl: string | null;
}

interface LearningSelectionMenuProps {
  courseId: string;
  sourceType: FocusTargetSource;
  sourceId?: string | null;
  sourceLabel?: string | null;
  children: ReactNode;
}

type MenuStatus = 'idle' | 'saving' | 'saved' | 'error';

function cleanSelection(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function selectionKindLabel(value: string): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (/[.!?。！？]$/.test(value) || words.length >= 6) return 'Sentence focus';
  if (words.length > 1) return 'Phrase focus';
  return 'Word focus';
}

function selectionBelongsTo(root: HTMLElement, selection: Selection): boolean {
  if (!selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer;
  const node = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentElement : ancestor;
  return !!node && root.contains(node);
}

export function LearningSelectionMenu({
  courseId,
  sourceType,
  sourceId = null,
  sourceLabel = null,
  children,
}: LearningSelectionMenuProps) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [selectionText, setSelectionText] = useState('');
  const [contextText, setContextText] = useState('');
  const [status, setStatus] = useState<MenuStatus>('idle');
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState<LearningTargetResponse | null>(null);
  const busy = status === 'saving';
  const kindLabel = selectionKindLabel(selectionText);

  const close = useCallback(() => {
    setOpen(false);
    setStatus('idle');
    setMessage('');
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
    }
    function onPointerDown(event: PointerEvent) {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) close();
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [close, open]);

  function openFromSelection(event: MouseEvent) {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection || !selectionBelongsTo(root, selection)) return;
    const text = cleanSelection(selection.toString());
    if (!text) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectionText(text);
    setContextText(cleanSelection(root.textContent ?? ''));
    setTarget(null);
    setStatus('idle');
    setMessage('');
    setOpen(true);
  }

  async function saveTarget(): Promise<LearningTargetResponse | null> {
    if (target) return target;
    setStatus('saving');
    setMessage('');
    const res = await fetch(`/api/v1/courses/${courseId}/learning-targets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: selectionText,
        contextText,
        sourceType,
        sourceId,
        sourceLabel,
        userMarkedDifficulty: 4,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus('error');
      setMessage(body.error ?? 'Could not save this target.');
      return null;
    }
    const saved = (await res.json()) as LearningTargetResponse;
    setTarget(saved);
    setStatus('saved');
    setMessage('Added to focused practice.');
    return saved;
  }

  async function addToPractice() {
    await saveTarget();
  }

  async function practiceInSentences() {
    const saved = await saveTarget();
    if (!saved) return;
    const params = new URLSearchParams({ course: courseId, target: saved.id, auto: 'sentences' });
    router.push(`/learn/practice?${params.toString()}`);
  }

  async function pronounce() {
    const saved = await saveTarget();
    if (!saved) return;
    setStatus('saving');
    const res = await fetch(
      `/api/v1/courses/${courseId}/learning-targets/${saved.id}/pronunciation`,
      { method: 'POST' },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus('error');
      setMessage(body.error ?? 'Pronunciation is not available.');
      return;
    }
    const updated = (await res.json()) as LearningTargetResponse;
    setTarget(updated);
    setStatus('saved');
    setMessage('Pronunciation ready.');
    if (updated.pronunciationAudioUrl) {
      await new Audio(updated.pronunciationAudioUrl).play().catch(() => undefined);
    }
  }

  async function addVisualCue() {
    const saved = await saveTarget();
    if (!saved) return;
    setStatus('saving');
    const res = await fetch(`/api/v1/courses/${courseId}/learning-targets/${saved.id}/visual-cue`, {
      method: 'POST',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus('error');
      setMessage(body.error ?? 'Visual cue is not available.');
      return;
    }
    const updated = (await res.json()) as LearningTargetResponse;
    setTarget(updated);
    setStatus('saved');
    setMessage('Visual cue added.');
  }

  return (
    <div ref={rootRef} className={styles.scope} onContextMenu={openFromSelection}>
      {children}
      {open && (
        <div className={styles.menu} role="menu" aria-label="Focused learning actions">
          <div className={styles.header}>
            <div className={styles.headerCopy}>
              <span className={styles.kicker}>{kindLabel}</span>
              <span className={styles.selection} title={selectionText}>
                {selectionText}
              </span>
            </div>
            <button type="button" className={styles.closeButton} onClick={close} aria-label="Close">
              <X size={16} />
            </button>
          </div>

          <div className={styles.primaryRow}>
            <button
              type="button"
              className={`${styles.action} ${styles.primaryAction}`}
              onClick={() => void practiceInSentences()}
              disabled={busy}
            >
              <Dumbbell size={18} />
              <span>Practice now</span>
            </button>
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.action}
              onClick={() => void addToPractice()}
              disabled={busy}
            >
              <BookmarkPlus size={18} />
              <span>Save focus</span>
            </button>
            <button
              type="button"
              className={styles.action}
              onClick={() => void pronounce()}
              disabled={busy}
            >
              <Volume2 size={18} />
              <span>Pronounce</span>
            </button>
            <button
              type="button"
              className={styles.action}
              onClick={() => void addVisualCue()}
              disabled={busy}
            >
              <ImagePlus size={18} />
              <span>Image cue</span>
            </button>
          </div>

          {(message || status === 'saving') && (
            <p className={status === 'error' ? styles.error : styles.status} role="status">
              {status === 'saving' ? 'Working…' : message}
            </p>
          )}

          {target?.visualCueUrl && (
            <figure className={styles.visualCue}>
              <Image
                src={target.visualCueUrl}
                alt={target.visualCueAlt ?? target.text}
                width={320}
                height={180}
                sizes="320px"
              />
            </figure>
          )}
        </div>
      )}
    </div>
  );
}
