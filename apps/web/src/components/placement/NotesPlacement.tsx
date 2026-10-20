'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SottoSpinner } from '@/components/ui/SottoSpinner';
import {
  analyzePlacementMaterials,
  materialPlacementReference,
  type MaterialAnalysisProjection,
  type MaterialPlacementCheckpoint,
  type MaterialPlacementReference,
} from '@/lib/course-materials/client/analysis';
import styles from './NotesPlacement.module.css';
import { MaterialCoverage, MaterialPartialConsent } from './MaterialCoverage';
import { MaterialAnalysisRetry } from './MaterialAnalysisRetry';

interface NotesPlacementProps {
  native: string;
  target: string;
  /** Called when the learner chooses to verify the deduced level with a quiz. */
  onVerify: (level: string, reference: MaterialPlacementReference) => void;
}

interface Deduction {
  deducedLevel: string;
  rationale: string;
  confidence: number;
  imported?: number;
  failed?: number;
  analysis: MaterialAnalysisProjection;
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
  const checkpoint = useRef<MaterialPlacementCheckpoint | null>(null);
  const confirmationId = useRef<string | null>(null);
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [progress, setProgress] = useState('Reading your materials');
  const [lastAnalysis, setLastAnalysis] = useState<MaterialAnalysisProjection | null>(null);
  useEffect(() => () => deduceController.current?.abort(), []);
  function invalidateSources() {
    deduceController.current?.abort();
    deduceController.current = null;
    checkpoint.current = null;
    confirmationId.current = null;
    setLastAnalysis(null);
    setDeduction(null);
    setAcceptPartial(false);
  }

  // Stop polling without replacing the admitted background operation.
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
    deduceController.current?.abort();
    deduceController.current = controller;
    try {
      const analysis = await analyzePlacementMaterials({
        native,
        target,
        content: text,
        files,
        signal: controller.signal,
        checkpoint: checkpoint.current,
        onCheckpoint: (value) => {
          checkpoint.current = value;
        },
        onProgress: setProgress,
        onProjection: setLastAnalysis,
      });
      controller.signal.throwIfAborted();
      const inference = analysis.summary?.inference;
      if (!inference)
        throw new Error(
          'The sources do not support a level estimate. Take the placement test or choose a level manually.'
        );
      setDeduction({
        deducedLevel: inference.level,
        rationale: inference.rationale,
        confidence: inference.confidence,
        analysis,
      });
      setAcceptPartial(false);
      confirmationId.current = crypto.randomUUID();
      setPhase('result');
    } catch (err) {
      // cancelDeduction already returned the learner to the form.
      if (controller.signal.aborted) return;
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not read the materials. Try again.'
      );
      setPhase('error');
    } finally {
      if (deduceController.current === controller) deduceController.current = null;
    }
  }

  async function startHere() {
    if (!deduction) return;
    setPhase('confirming');
    try {
      const res = await fetch('/api/v1/placement/from-notes/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 1,
          requestId: confirmationId.current,
          native,
          target,
          ...materialPlacementReference(deduction.analysis, acceptPartial),
        }),
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

  async function resumeRetry(analysisId: string, parentId: string) {
    if (!checkpoint.current || checkpoint.current.analysisId !== parentId)
      throw new Error('The source selection changed. Open its current analysis before retrying.');
    checkpoint.current.analysisId = analysisId;
    await deduce();
  }

  if (phase === 'deducing' || phase === 'confirming') {
    return (
      <div className={styles.center} role="status" aria-live="polite">
        <SottoSpinner
          size="large"
          label={phase === 'deducing' ? progress : 'Setting up your course'}
          orientation="stack"
        />
        {phase === 'deducing' && (
          <button type="button" className={styles.secondaryButton} onClick={cancelDeduction}>
            Stop waiting
          </button>
        )}
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className={styles.center} role="alert">
        <p className={styles.errorMessage}>{errorMessage}</p>
        <MaterialAnalysisRetry analysis={lastAnalysis} onRetry={resumeRetry} />
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
        <MaterialCoverage analysis={deduction.analysis} />
        <MaterialAnalysisRetry analysis={deduction.analysis} onRetry={resumeRetry} />
        <p className={styles.note}>
          {deduction.analysis.summary?.focusCount ?? 0} source classes found. Your learning
          objectives remain unassessed.
        </p>
        {deduction.analysis.status === 'PARTIAL' && (
          <MaterialPartialConsent
            checked={acceptPartial}
            disabled={!deduction.analysis.coverage}
            onChange={setAcceptPartial}
          />
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={
              deduction.analysis.status === 'PARTIAL' &&
              (!acceptPartial || !deduction.analysis.coverage)
            }
            onClick={() => void startHere()}
          >
            Start here
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={
              deduction.analysis.status === 'PARTIAL' &&
              (!acceptPartial || !deduction.analysis.coverage)
            }
            onClick={() =>
              onVerify(
                deduction.deducedLevel,
                materialPlacementReference(deduction.analysis, acceptPartial)
              )
            }
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
        onChange={(e) => {
          setText(e.target.value);
          invalidateSources();
        }}
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
          onChange={(e) => {
            setFiles(Array.from(e.target.files ?? []));
            invalidateSources();
          }}
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
