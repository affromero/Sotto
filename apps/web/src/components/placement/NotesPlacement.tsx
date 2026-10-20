'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SottoSpinner } from '@/components/ui/SottoSpinner';
import {
  analyzePlacementMaterials,
  openSavedMaterialAnalysis,
  forgetSavedMaterialAnalysis,
  materialPlacementReference,
  type MaterialAnalysisProjection,
  type MaterialPlacementCheckpoint,
  type MaterialPlacementReference,
} from '@/lib/course-materials/client/analysis';
import {
  readSavedMaterialPlacement,
  saveMaterialPlacementConfirmation,
  saveMaterialPlacementRetry,
  type SavedMaterialPlacementCheckpoint,
} from '@/lib/course-materials/client/placement-checkpoint';
import styles from './NotesPlacement.module.css';
import { MaterialCoverage, MaterialPartialConsent } from './MaterialCoverage';
import { MaterialAnalysisRetry } from './MaterialAnalysisRetry';
import { MaterialAnalysisCancellation } from './analysis-controls/MaterialAnalysisCancellation';

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
  const savedCheckpoint = useRef<SavedMaterialPlacementCheckpoint | null>(null);
  const confirmationId = useRef<string | null>(null);
  const confirmationBody = useRef<string | null>(null);
  const [confirmationFailed, setConfirmationFailed] = useState(false);
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [progress, setProgress] = useState('Reading your materials');
  const [lastAnalysis, setLastAnalysis] = useState<MaterialAnalysisProjection | null>(null);
  useEffect(() => () => deduceController.current?.abort(), []);
  function invalidateSources() {
    deduceController.current?.abort();
    deduceController.current = null;
    checkpoint.current = null;
    savedCheckpoint.current = null;
    confirmationId.current = null;
    confirmationBody.current = null;
    setLastAnalysis(null);
    setDeduction(null);
    setAcceptPartial(false);
    setConfirmationFailed(false);
  }

  // Stop polling without replacing the admitted background operation.
  const cancelDeduction = useCallback(() => {
    deduceController.current?.abort();
    deduceController.current = null;
    setPhase('input');
  }, []);

  const hasMaterials = text.trim().length > 0 || files.length > 0;

  async function deduce(savedOnly = false) {
    setConfirmationFailed(false);
    setPhase('deducing');
    setErrorMessage('');
    const controller = new AbortController();
    deduceController.current?.abort();
    deduceController.current = controller;
    try {
      const callbacks = { onProgress: setProgress, onProjection: setLastAnalysis };
      const analysis = savedOnly
        ? await openSavedMaterialAnalysis({
            native,
            target,
            signal: controller.signal,
            ...callbacks,
            onSaved: (value) => {
              savedCheckpoint.current = value;
              setText('');
              setFiles([]);
            },
          })
        : await analyzePlacementMaterials({
            native,
            target,
            content: text,
            files,
            signal: controller.signal,
            checkpoint: checkpoint.current,
            onCheckpoint: (value) => {
              checkpoint.current = value;
              savedCheckpoint.current = readSavedMaterialPlacement(value.profileId, native, target);
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
      const retained =
        savedCheckpoint.current?.analysisId === analysis.analysisId
          ? savedCheckpoint.current.confirmation
          : null;
      confirmationId.current = retained?.requestId ?? crypto.randomUUID();
      confirmationBody.current = retained?.body ?? null;
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
    confirmationBody.current ??= JSON.stringify({
      schemaVersion: 1,
      requestId: confirmationId.current,
      native,
      target,
      ...materialPlacementReference(deduction.analysis, acceptPartial),
    });
    try {
      const profileId = savedCheckpoint.current?.profileId ?? checkpoint.current?.profileId;
      if (!profileId)
        throw new Error('Reopen the saved analysis before confirming its learner identity.');
      saveMaterialPlacementConfirmation(profileId, native, target, confirmationBody.current);
      const res = await fetch('/api/v1/placement/from-notes/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sotto-expected-profile-id': profileId },
        body: confirmationBody.current,
      });
      if (!res.ok) {
        setConfirmationFailed(true);
        const body = await res.json().catch(() => ({}));
        setErrorMessage(body.error ?? 'Could not start your course. Please try again.');
        setPhase('error');
        return;
      }
      router.push('/learn');
    } catch (cause) {
      setConfirmationFailed(true);
      setErrorMessage(
        cause instanceof Error
          ? cause.message
          : 'The course confirmation could not be read. Retry its saved request.'
      );
      setPhase('error');
    }
  }

  async function resumeRetry(analysisId: string, parentId: string) {
    const previous = savedCheckpoint.current;
    if (!previous || previous.analysisId !== parentId)
      throw new Error('The source selection changed. Open its current analysis before retrying.');
    saveMaterialPlacementRetry(previous.profileId, native, target, parentId, analysisId);
    if (checkpoint.current?.analysisId === parentId) checkpoint.current.analysisId = analysisId;
    await deduce(true);
  }

  async function forgetSaved() {
    const controller = new AbortController();
    deduceController.current?.abort();
    deduceController.current = controller;
    try {
      await forgetSavedMaterialAnalysis(native, target, controller.signal);
      if (controller.signal.aborted) return;
      invalidateSources();
      setErrorMessage('');
      setPhase('input');
    } catch (cause) {
      if (!controller.signal.aborted)
        setErrorMessage(
          cause instanceof Error ? cause.message : 'Could not clear this browser resume record.'
        );
    } finally {
      if (deduceController.current === controller) deduceController.current = null;
    }
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
        {phase === 'deducing' && <MaterialAnalysisCancellation analysis={lastAnalysis} />}
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className={styles.center} role="alert">
        <p className={styles.errorMessage}>{errorMessage}</p>
        <MaterialAnalysisRetry analysis={lastAnalysis} onRetry={resumeRetry} />
        <MaterialAnalysisCancellation analysis={lastAnalysis} />
        {deduction && confirmationFailed && (
          <button type="button" className={styles.primaryButton} onClick={() => void startHere()}>
            Retry course confirmation
          </button>
        )}
        <button type="button" className={styles.secondaryButton} onClick={() => setPhase('input')}>
          Try again
        </button>
        <button type="button" className={styles.secondaryButton} onClick={() => void forgetSaved()}>
          Clear this browser&apos;s saved progress
        </button>
        <p>
          Clears the resume record for the active learner. Saved sources and background work stay on
          the server.
        </p>
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
      <button type="button" className={styles.secondaryButton} onClick={() => void deduce(true)}>
        Open saved analysis
      </button>
    </div>
  );
}
