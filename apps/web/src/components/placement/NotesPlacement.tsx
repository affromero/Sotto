'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SottoSpinner } from '@/components/ui/SottoSpinner';
import styles from './NotesPlacement.module.css';

interface NotesPlacementProps {
  native: string;
  target: string;
  /** Called when the learner chooses to verify the deduced level with a quiz. */
  onVerify: (level: string) => void;
}

interface Deduction {
  deducedLevel: string;
  rationale: string;
  confidence: number;
  imported?: number;
  failed?: number;
}

type Phase = 'input' | 'deducing' | 'result' | 'confirming' | 'error';

const LEVEL_DESCRIPTIONS: Record<string, string> = {
  A1: 'Beginner',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper-Intermediate',
  C1: 'Advanced',
  C2: 'Proficient',
};

export function NotesPlacement({ native, target, onVerify }: NotesPlacementProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('input');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [deduction, setDeduction] = useState<Deduction | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const deduceController = useRef<AbortController | null>(null);

  // Only the deduction is cancellable. `confirming` is creating the course
  // itself — aborting mid-create would leave a half-built course behind, which
  // is worse for the learner than the few seconds it takes to finish.
  const cancelDeduction = useCallback(() => {
    deduceController.current?.abort();
    deduceController.current = null;
    setPhase('input');
  }, []);

  const hasMaterials = text.trim().length > 0 || files.length > 0;

  async function deduce() {
    setPhase('deducing');
    setErrorMessage('');
    const controller = new AbortController();
    deduceController.current = controller;
    try {
      const form = new FormData();
      form.set('native', native);
      form.set('target', target);
      if (text.trim()) form.set('content', text.trim());
      for (const file of files) form.append('files', file);

      const res = await fetch('/api/v1/placement/from-notes/upload', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMessage(
          body.error ?? 'Could not read your materials. Try a different file or paste some text.'
        );
        setPhase('error');
        return;
      }
      setDeduction(await res.json());
      setPhase('result');
    } catch (err) {
      // cancelDeduction already returned the learner to the form.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setErrorMessage('A network error occurred. Please check your connection and try again.');
      setPhase('error');
    } finally {
      if (deduceController.current === controller) deduceController.current = null;
    }
  }

  async function startHere() {
    setPhase('confirming');
    try {
      const res = await fetch('/api/v1/placement/from-notes/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ native, target }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMessage(body.error ?? 'Could not start your course. Please try again.');
        setPhase('error');
        return;
      }
      router.push('/learn');
    } catch {
      setErrorMessage('A network error occurred while starting your course. Please try again.');
      setPhase('error');
    }
  }

  if (phase === 'deducing' || phase === 'confirming') {
    return (
      <div className={styles.center} role="status" aria-live="polite">
        <SottoSpinner
          size="large"
          label={phase === 'deducing' ? 'Reading your materials' : 'Setting up your course'}
          orientation="stack"
        />
        {phase === 'deducing' && (
          <button type="button" className={styles.secondaryButton} onClick={cancelDeduction}>
            Cancel
          </button>
        )}
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className={styles.center} role="alert">
        <p className={styles.errorMessage}>{errorMessage}</p>
        <button type="button" className={styles.secondaryButton} onClick={() => setPhase('input')}>
          Try again
        </button>
      </div>
    );
  }

  if (phase === 'result' && deduction) {
    const confidencePct = Math.round(deduction.confidence * 100);
    return (
      <div className={styles.result} aria-live="polite">
        <div
          className={styles.levelBadge}
          aria-label={`Estimated level: ${deduction.deducedLevel}`}
        >
          <span className={styles.levelCode}>{deduction.deducedLevel}</span>
          <span className={styles.levelLabel}>
            {LEVEL_DESCRIPTIONS[deduction.deducedLevel] ?? 'Your level'}
          </span>
        </div>
        <p className={styles.rationale}>
          {deduction.rationale || 'Estimated from the materials you shared.'}
        </p>
        <p className={styles.confidence}>Confidence: {confidencePct}%</p>

        <div className={styles.actions}>
          <button type="button" className={styles.primaryButton} onClick={() => void startHere()}>
            Start here
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => onVerify(deduction.deducedLevel)}
          >
            Verify with a few questions
          </button>
        </div>
        <p className={styles.note}>Starting here never lowers a level you have already reached.</p>
      </div>
    );
  }

  // phase === 'input'
  return (
    <div className={styles.root}>
      <label className={styles.fieldLabel} htmlFor="notes-text">
        Paste notes, a lesson, or your own writing in your target language
      </label>
      <textarea
        id="notes-text"
        className={styles.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        maxLength={20000}
        placeholder="Paste a paragraph or two of the material you are working with..."
      />

      <div className={styles.uploadRow}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => fileInputRef.current?.click()}
        >
          Add files
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className={styles.hiddenInput}
          multiple
          accept=".txt,.md,.csv,.html,.json,.rtf,.pdf,.docx,.pptx,.xlsx,.epub"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
        {files.length > 0 && (
          <span className={styles.fileCount}>
            {files.length} file{files.length === 1 ? '' : 's'} selected
          </span>
        )}
      </div>

      <button
        type="button"
        className={styles.primaryButton}
        onClick={() => void deduce()}
        disabled={!hasMaterials}
        aria-disabled={!hasMaterials}
      >
        Find my level
      </button>
    </div>
  );
}
