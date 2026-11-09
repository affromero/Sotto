'use client';

/**
 * SpeakingSection renders the say-it-aloud module from the design bundle
 * (`class-speaking.jsx`): the round record button, live wave, and post-record
 * score bars + coach tip. It reuses the proven upload/poll wiring from
 * `SpeakingExercise` (record → POST to `{endpointBase}/{promptId}` → poll until
 * SCORED) but renders the design's record UI.
 *
 * Adaptation: the design scores per-syllable; our backend returns a 3-axis
 * rubric (accuracy / fluency / completeness). The design's phoneme bars are
 * therefore driven by those three rubric axes.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SottoSpinner } from '@/components/ui/SottoSpinner';
import { useAudioRecorder } from '@/lib/hooks/useAudioRecorder';
import {
  clearSpeakingUpload,
  downloadSpeakingRecording,
  pendingSpeakingUpload,
  readSpeakingUploadRecovery,
  rememberSpeakingUploadReceipt,
  retainSpeakingUpload,
} from './speaking/speakingUploadRecovery';
import { ClassGlyph } from './ClassGlyph';
import { ContinueBar, ScoreDial } from './ClassWidgets';
import type { ClassSpeakingPrompt, ClassSpeakingRecording } from './classTypes';
import styles from './SpeakingSection.module.css';
import type { ClassPrerequisiteDirections } from './lesson/prerequisiteTypes';
import { TaskDirection, taskDirection } from './lesson/TaskDirection';
import { SpeakingRecoveryNotice } from './speaking/SpeakingRecoveryNotice';
import {
  captureLearningAuthority,
  learningAuthorityIsCurrent,
  learningBindingIsCurrent,
  type ClassProgressBinding,
} from './progress/useLearningProgress';

type SpeakingTaskPrompt = ClassSpeakingPrompt & { taskMode?: 'READ_ALOUD' | 'COMMUNICATIVE' };

const POLL_INTERVAL_MS = 1500;
const RUBRIC_AXES: { key: 'accuracy' | 'fluency' | 'completeness'; label: string }[] = [
  { key: 'accuracy', label: 'accuracy' },
  { key: 'fluency', label: 'fluency' },
  { key: 'completeness', label: 'completeness' },
];

interface RubricScores {
  accuracy?: number;
  fluency?: number;
  completeness?: number;
  communicative?: number;
}

interface AlignmentToken {
  op: 'match' | 'substitute' | 'delete' | 'insert';
  expected?: string;
  actual?: string;
}

interface ScoringResult {
  recordingId: string;
  transcript?: string | null;
  overallScore?: number | null;
  rubricScores?: RubricScores | null;
  phonemeScores?: AlignmentToken[] | null;
  feedback?: string | null;
  status: 'PENDING' | 'GRADING' | 'SCORED' | 'FAILED' | 'UNRESOLVED';
  recoveryAcknowledged?: boolean;
}

type CardPhase =
  | 'idle'
  | 'recording'
  | 'recording_held'
  | 'uploading'
  | 'grading'
  | 'scored'
  | 'failed'
  | 'poll_unknown'
  | 'upload_unknown'
  | 'unresolved';

const unresolvedMessage =
  'The grading outcome is unknown. Your recording is saved. Contact your server administrator before another attempt.';

interface CardState {
  phase: CardPhase;
  recordingId: string | null;
  result: ScoringResult | null;
  error: string | null;
}

interface SpeakingSectionProps {
  endpointBase: string;
  classBinding?: ClassProgressBinding | null;
  sectionId?: string;
  prerequisiteDirections?: ClassPrerequisiteDirections | null;
  prompts: SpeakingTaskPrompt[];
  gate: number; // 0..100
  nextName: string | null;
  /** Report the running 0..100 average overall score upward. */
  onScore: (score: number) => void;
  onFeedback?: (promptId: string, recording: ClassSpeakingRecording) => void;
  feedbackHref?: string;
  onContinue: () => void;
}

// ---- one prompt card ----

interface PromptCardProps {
  endpointBase: string;
  classBinding?: ClassProgressBinding | null;
  prompt: SpeakingTaskPrompt;
  index: number;
  total: number;
  onScored: (promptId: string, result: ScoringResult) => void;
  onPending: (promptId: string) => void;
  feedbackHref: string;
  direction?: { id: string; text: string; language: string };
}

function PromptCard({
  endpointBase,
  classBinding,
  prompt,
  index,
  total,
  onScored,
  onPending,
  feedbackHref,
  direction,
}: PromptCardProps) {
  const [state, setState] = useState<CardState>(() => {
    const pending = pendingSpeakingUpload(endpointBase, prompt.id);
    const saved = prompt.latestRecording;
    if (pending)
      return {
        phase: 'upload_unknown',
        recordingId: null,
        result: null,
        error: 'Upload outcome is unknown. Check saved recording before recording another attempt.',
      };
    return {
      phase: saved
        ? saved.status === 'SCORED'
          ? 'scored'
          : saved.status === 'FAILED'
            ? 'failed'
            : saved.status === 'UNRESOLVED'
              ? 'unresolved'
              : 'grading'
        : 'idle',
      recordingId: saved?.id ?? null,
      result: saved ? { ...saved, recordingId: saved.id } : null,
      error:
        saved?.status === 'FAILED'
          ? 'Scoring failed. Record another attempt.'
          : saved?.status === 'UNRESOLVED'
            ? unresolvedMessage
            : null,
    };
  });
  const acknowledgedId = useRef(prompt.latestRecording?.id ?? null);
  const originalBinding = useRef(classBinding ? { ...classBinding } : classBinding);
  const latestBinding = useRef(classBinding);
  useLayoutEffect(() => {
    latestBinding.current = classBinding;
  }, [classBinding]);
  const authorityEndpoint = endpointBase.replace(/\/speaking$/, '');
  const requiresBinding = /^\/api\/v1\/classes\/[^/]+$/.test(authorityEndpoint);
  const recordingAuthority = useRef(captureLearningAuthority(authorityEndpoint));
  const handledBlob = useRef<Blob | null>(null);
  const uploadInFlight = useRef(false);
  const [heldForPreviousUpload, setHeldForPreviousUpload] = useState(false);
  const sameBinding = useCallback(() => {
    const original = originalBinding.current;
    const latest = latestBinding.current;
    if (requiresBinding && (!original || !latest)) return false;
    if (original === undefined || latest === undefined) return original === latest;
    return Boolean(
      original &&
      latest &&
      original.expectedAttempt === latest.expectedAttempt &&
      original.taskMaterialRevision === latest.taskMaterialRevision
    );
  }, [requiresBinding]);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollGeneration = useRef(0);
  const cardGeneration = useRef(0);
  const recoveryGeneration = useRef(0);
  const recorder = useAudioRecorder({ maxSeconds: 60, minSeconds: 2 });

  useEffect(() => {
    return () => {
      cardGeneration.current += 1;
      recoveryGeneration.current += 1;
      pollGeneration.current += 1;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const uploadRecording = useCallback(
    async (blob: Blob, explicitRetry = false) => {
      if (uploadInFlight.current) return;
      const currentAuthority = captureLearningAuthority(authorityEndpoint);
      if (
        currentAuthority === null ||
        !sameBinding() ||
        originalBinding.current === null ||
        !learningBindingIsCurrent(authorityEndpoint, originalBinding.current) ||
        (!explicitRetry && currentAuthority !== recordingAuthority.current)
      ) {
        setState((previous) => ({
          ...previous,
          phase: 'recording_held',
          error: 'Check the class before uploading. Download this recording before leaving.',
        }));
        return;
      }
      uploadInFlight.current = true;
      const card = cardGeneration.current;
      let fence: NonNullable<ReturnType<typeof pendingSpeakingUpload>>;
      try {
        fence = retainSpeakingUpload(
          endpointBase,
          prompt.id,
          acknowledgedId.current,
          originalBinding.current ?? undefined
        );
      } catch {
        uploadInFlight.current = false;
        setHeldForPreviousUpload(Boolean(pendingSpeakingUpload(endpointBase, prompt.id)));
        setState((previous) => ({
          ...previous,
          phase: 'recording_held',
          error:
            'The recording cannot be sent safely. Download it before leaving and check any earlier upload.',
        }));
        return;
      }
      setHeldForPreviousUpload(false);
      setState((prev) => ({ ...prev, phase: 'uploading', error: null }));
      try {
        const form = new FormData();
        form.append('audio', blob, 'recording.webm');
        if (originalBinding.current) {
          form.append('expectedAttempt', String(originalBinding.current.expectedAttempt));
          form.append('taskMaterialRevision', originalBinding.current.taskMaterialRevision);
        }
        const res = await fetch(`${endpointBase}/${prompt.id}`, { method: 'POST', body: form });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
          if (cardGeneration.current !== card) return;
          if (pendingSpeakingUpload(endpointBase, prompt.id) !== fence) return;
          if (
            (res.status === 409 &&
              ['CLASS_MATERIAL_CHANGED', 'PREREQUISITE_ACK_REQUIRED'].includes(body.code ?? '')) ||
            ([400, 401, 404, 409].includes(res.status) && body.code === 'CLASS_RECORDING_REJECTED')
          ) {
            if (!clearSpeakingUpload(endpointBase, prompt.id, fence)) return;
            setState((previous) => ({
              ...previous,
              phase: 'recording_held',
              error:
                'The class changed before this recording was accepted. Download it before leaving.',
            }));
            return;
          }
          setState((prev) => ({
            ...prev,
            phase: 'upload_unknown',
            error: body.error ?? 'Upload failed.',
          }));
          return;
        }
        const data = (await res.json()) as { recordingId: string };
        if (!data.recordingId) throw new Error('Upload acknowledgement is incomplete');
        const receipt = rememberSpeakingUploadReceipt(
          endpointBase,
          prompt.id,
          data.recordingId,
          fence
        );
        fence = receipt.fence;
        acknowledgedId.current = data.recordingId;
        if (cardGeneration.current !== card) return;
        if (!receipt.persisted) {
          setState((previous) => ({
            ...previous,
            phase: 'upload_unknown',
            recordingId: data.recordingId,
            error:
              'Your recording was saved, but its receipt could not be stored on this device. Check it before leaving.',
          }));
          return;
        }
        if (
          !learningAuthorityIsCurrent(authorityEndpoint, currentAuthority) ||
          !sameBinding() ||
          !learningBindingIsCurrent(authorityEndpoint, originalBinding.current)
        ) {
          setState((previous) => ({
            ...previous,
            phase: 'upload_unknown',
            recordingId: data.recordingId,
            error: 'Your recording is saved. Check the class before checking its status.',
          }));
          return;
        }
        if (!clearSpeakingUpload(endpointBase, prompt.id, fence)) return;
        setState((prev) => ({ ...prev, phase: 'grading', recordingId: data.recordingId }));
      } catch {
        if (cardGeneration.current !== card) return;
        if (pendingSpeakingUpload(endpointBase, prompt.id) !== fence) return;
        setState((prev) => ({
          ...prev,
          phase: 'upload_unknown',
          error:
            'Upload outcome is unknown. Check saved recording before recording another attempt.',
        }));
      } finally {
        uploadInFlight.current = false;
      }
    },
    [authorityEndpoint, endpointBase, prompt.id, sameBinding]
  );

  // Upload once the recorded blob lands.
  useEffect(() => {
    if (!recorder.recordedBlob || handledBlob.current === recorder.recordedBlob) return;
    const blob = recorder.recordedBlob;
    handledBlob.current = blob;
    void (async () => {
      await uploadRecording(blob);
    })();
  }, [recorder.recordedBlob, uploadRecording]);

  const pollResult = useCallback(
    (recordingId: string) => {
      const generation = ++pollGeneration.current;
      const current = () => pollGeneration.current === generation;
      // Self-contained polling loop: `tick` reschedules itself rather than the
      // memoized callback, so the callback never references its own identity.
      const tick = async () => {
        if (!current()) return;
        const authority = captureLearningAuthority(authorityEndpoint);
        if (
          authority === null ||
          !sameBinding() ||
          originalBinding.current === null ||
          !learningBindingIsCurrent(authorityEndpoint, originalBinding.current)
        ) {
          setState((previous) => ({
            ...previous,
            phase: 'poll_unknown',
            error: 'Check the class status before checking this recording.',
          }));
          return;
        }
        try {
          const res = await fetch(
            `${endpointBase}/${prompt.id}?recordingId=${encodeURIComponent(recordingId)}`
          );
          if (!current()) return;
          if (!res.ok) {
            pollTimerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
            return;
          }
          const data = (await res.json()) as ScoringResult;
          if (!current()) return;
          if (
            !learningAuthorityIsCurrent(authorityEndpoint, authority) ||
            !sameBinding() ||
            !learningBindingIsCurrent(authorityEndpoint, originalBinding.current)
          ) {
            setState((previous) => ({
              ...previous,
              phase: 'poll_unknown',
              error: 'Check the class status before checking this recording.',
            }));
            return;
          }
          if (data.recordingId !== recordingId) {
            setState((previous) => ({
              ...previous,
              phase: 'poll_unknown',
              error: 'The recording status could not be verified. Check it again.',
            }));
            return;
          }
          if (
            data.status === 'SCORED' ||
            data.status === 'FAILED' ||
            data.status === 'UNRESOLVED'
          ) {
            setState((prev) => ({
              ...prev,
              phase:
                data.status === 'SCORED'
                  ? 'scored'
                  : data.status === 'UNRESOLVED'
                    ? 'unresolved'
                    : 'failed',
              result: data,
              error:
                data.status === 'FAILED'
                  ? 'Scoring failed. Please try again.'
                  : data.status === 'UNRESOLVED'
                    ? unresolvedMessage
                    : null,
            }));
            if (data.status === 'SCORED' && typeof data.overallScore === 'number') {
              onScored(prompt.id, data);
            }
          } else {
            pollTimerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
          }
        } catch {
          if (current()) pollTimerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
        }
      };
      void tick();
      return () => {
        if (current()) pollGeneration.current += 1;
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      };
    },
    [authorityEndpoint, endpointBase, prompt.id, onScored, sameBinding]
  );

  useEffect(() => {
    if (state.phase !== 'grading' || !state.recordingId) return;
    return pollResult(state.recordingId);
  }, [state.phase, state.recordingId, pollResult]);

  async function checkSavedUpload() {
    const recovery = ++recoveryGeneration.current;
    const card = cardGeneration.current;
    const current = () =>
      recoveryGeneration.current === recovery && cardGeneration.current === card;
    try {
      const authority = captureLearningAuthority(authorityEndpoint);
      const binding = originalBinding.current;
      if (
        authority === null ||
        !sameBinding() ||
        binding === null ||
        !learningBindingIsCurrent(authorityEndpoint, binding)
      )
        throw new Error('Check the class status before checking this recording.');
      const classMatch = /^\/api\/v1\/classes\/([^/]+)$/.exec(authorityEndpoint);
      if (classMatch && !binding) throw new Error('The original class binding is unavailable.');
      if (binding && !classMatch) throw new Error('The original class identity is unavailable.');
      const candidate = await readSpeakingUploadRecovery(
        endpointBase,
        prompt.id,
        binding && classMatch
          ? {
              classId: decodeURIComponent(classMatch[1]),
              binding,
              isCurrent: () =>
                learningAuthorityIsCurrent(authorityEndpoint, authority) &&
                sameBinding() &&
                current() &&
                learningBindingIsCurrent(authorityEndpoint, binding),
            }
          : undefined
      );
      if (!current()) return;
      candidate.commit();
      const result = candidate.evidence;
      acknowledgedId.current = result.recordingId;
      setState({
        phase:
          result.status === 'SCORED'
            ? 'scored'
            : result.status === 'FAILED'
              ? 'failed'
              : result.status === 'UNRESOLVED'
                ? 'unresolved'
                : 'grading',
        recordingId: result.recordingId,
        result,
        error:
          result.status === 'FAILED'
            ? 'Scoring failed. Record another attempt.'
            : result.status === 'UNRESOLVED'
              ? unresolvedMessage
              : null,
      });
      if (result.status === 'SCORED') onScored(prompt.id, result);
    } catch (failure: unknown) {
      if (!current()) return;
      setState((previous) => ({
        ...previous,
        error: failure instanceof Error ? failure.message : 'Saved recording could not be checked.',
      }));
    }
  }

  async function handleStart() {
    const authority = captureLearningAuthority(authorityEndpoint);
    if (
      authority === null ||
      !sameBinding() ||
      originalBinding.current === null ||
      !learningBindingIsCurrent(authorityEndpoint, originalBinding.current)
    ) {
      setState((previous) => ({
        ...previous,
        phase: 'failed',
        error: 'Check the class status before recording.',
      }));
      return;
    }
    recordingAuthority.current = authority;
    const card = cardGeneration.current;
    handledBlob.current = null;
    onPending(prompt.id);
    recorder.reset();
    setState({ phase: 'recording', recordingId: null, result: null, error: null });
    const canStart = () =>
      cardGeneration.current === card &&
      learningAuthorityIsCurrent(authorityEndpoint, authority) &&
      sameBinding() &&
      learningBindingIsCurrent(authorityEndpoint, originalBinding.current);
    await recorder.startRecording(canStart);
    if (!canStart()) {
      recorder.stopRecording();
      if (cardGeneration.current === card)
        setState((previous) =>
          previous.phase === 'recording_held'
            ? previous
            : {
                ...previous,
                phase: 'failed',
                error: 'Check the class status before recording.',
              }
        );
    }
  }

  function handleStop() {
    recorder.stopRecording();
  }

  function handleReset() {
    onPending(prompt.id);
    recorder.reset();
    setState({ phase: 'idle', recordingId: null, result: null, error: null });
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
  }

  function downloadRecording() {
    const blob = recorder.recordedBlob;
    if (!blob) return;
    downloadSpeakingRecording(blob);
  }

  const { phase, result, error } = state;
  const overall = result?.overallScore != null ? Math.round(result.overallScore * 100) : 0;
  const rubric = result?.rubricScores ?? null;
  const isBusy = phase === 'uploading' || phase === 'grading';
  const focusTokens =
    result?.phonemeScores?.filter((token) => token.op !== 'match').slice(0, 4) ?? [];

  return (
    <article
      className={styles.speakCard}
      id={`speaking-prompt-${prompt.id}`}
      aria-label={`Speaking prompt ${index + 1} of ${total}`}
      aria-describedby={direction?.id}
    >
      {prompt.assessmentScope === 'PRIVATE_SOURCE' && (
        <p className={styles.speakEn}>
          Private source feedback. This practice does not count toward level mastery.
        </p>
      )}
      <div className={styles.promptBlock}>
        <div className={styles.promptLabel}>
          {prompt.taskMode === 'COMMUNICATIVE' ? 'Your task' : 'Say this'}
        </div>
        <div className={styles.speakTarget} lang="auto">
          {prompt.targetPhrase}
        </div>
      </div>
      {direction && (
        <TaskDirection id={direction.id} text={direction.text} language={direction.language} />
      )}
      <div className={styles.cueBlock}>
        <div className={styles.promptLabel}>
          {prompt.taskMode === 'COMMUNICATIVE' ? 'Constraints' : 'Meaning / cue'}
        </div>
        <div className={styles.speakEn}>{prompt.translation}</div>
      </div>
      {prompt.taskMode !== 'COMMUNICATIVE' && prompt.ipa && (
        <div className={styles.speakIpa} aria-label={`Pronunciation: ${prompt.ipa}`}>
          {prompt.ipa}
        </div>
      )}

      <div className={styles.recZone}>
        {phase === 'recording' ? (
          <>
            <div className={styles.liveWave} aria-hidden="true">
              {Array.from({ length: 28 }).map((_, i) => (
                <span key={i} className={styles.liveBar} />
              ))}
            </div>
            <button
              type="button"
              className={`${styles.recBtn} ${styles.recBtnRecording}`}
              onClick={handleStop}
              aria-label="Stop recording"
            >
              <ClassGlyph name="mic" size={28} />
            </button>
            <div className={styles.recHint} aria-live="polite">
              listening{recorder.duration > 0 ? ` · ${recorder.duration}s` : '…'}
            </div>
          </>
        ) : isBusy ? (
          <div className={styles.busyRow} role="status" aria-live="polite">
            <SottoSpinner
              size="medium"
              label={phase === 'uploading' ? 'Uploading your recording' : 'Grading your speaking'}
            />
          </div>
        ) : phase === 'unresolved' ? (
          <SpeakingRecoveryNotice
            endpointBase={endpointBase}
            promptId={prompt.id}
            recordingId={state.recordingId}
            acknowledged={result?.recoveryAcknowledged === true}
            onAcknowledged={() =>
              setState((previous) =>
                previous.phase === 'unresolved' &&
                previous.recordingId === state.recordingId &&
                previous.result
                  ? { ...previous, result: { ...previous.result, recoveryAcknowledged: true } }
                  : previous
              )
            }
            onRetry={handleReset}
          />
        ) : phase === 'recording_held' && recorder.recordedBlob ? (
          <div className={styles.failedRow} role="alert">
            <span className={styles.failedText}>{error}</span>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={downloadRecording}
            >
              Download recording
            </button>
            {!heldForPreviousUpload && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={() => void uploadRecording(recorder.recordedBlob!, true)}
              >
                Upload this recording
              </button>
            )}
          </div>
        ) : phase === 'poll_unknown' ? (
          <div className={styles.failedRow} role="alert">
            <span className={styles.failedText}>{error}</span>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() =>
                setState((previous) => ({ ...previous, phase: 'grading', error: null }))
              }
            >
              Check recording status
            </button>
          </div>
        ) : phase === 'upload_unknown' ? (
          <div className={styles.failedRow} role="alert">
            <span className={styles.failedText}>{error}</span>
            {recorder.recordedBlob && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={downloadRecording}
              >
                Download recording
              </button>
            )}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => void checkSavedUpload()}
            >
              Check saved recording
            </button>
          </div>
        ) : phase === 'scored' && result ? (
          <div className={styles.scoredZone}>
            <div
              className={styles.phoneme}
              role="group"
              aria-label={
                prompt.taskMode === 'COMMUNICATIVE'
                  ? 'Communicative task feedback'
                  : 'Pronunciation breakdown'
              }
            >
              {(prompt.taskMode === 'COMMUNICATIVE'
                ? [{ key: 'communicative' as const, label: 'communicative task' }]
                : RUBRIC_AXES
              ).map((axis) => {
                const raw = rubric?.[axis.key];
                if (typeof raw !== 'number') return null;
                const v = typeof raw === 'number' ? Math.round(raw * 100) : 0;
                const band = v >= 88 ? styles.phBarHi : v >= 74 ? styles.phBarMid : styles.phBarLo;
                return (
                  <div className={styles.ph} key={axis.key}>
                    <div
                      className={styles.phBarTrack}
                      role="progressbar"
                      aria-valuenow={v}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${axis.label}: ${v}%`}
                    >
                      <div className={`${styles.phBar} ${band}`} style={{ height: `${v}%` }} />
                    </div>
                    <div className={styles.phSyl}>{axis.label}</div>
                  </div>
                );
              })}
            </div>
            {result.transcript && (
              <div className={styles.transcriptBlock}>
                <span className={styles.transcriptLabel}>You said</span>
                <p className={styles.transcript}>&ldquo;{result.transcript}&rdquo;</p>
              </div>
            )}
            {prompt.taskMode !== 'COMMUNICATIVE' && focusTokens.length > 0 && (
              <div className={styles.soundFocus} aria-label="Pronunciation focus">
                {focusTokens.map((token, tokenIndex) => (
                  <span className={styles.soundChip} key={`${token.op}-${tokenIndex}`}>
                    {token.expected && token.actual
                      ? `${token.expected} -> ${token.actual}`
                      : token.expected
                        ? token.expected
                        : token.actual}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <button
              type="button"
              className={styles.recBtn}
              onClick={() => void handleStart()}
              aria-label={
                prompt.taskMode === 'COMMUNICATIVE'
                  ? 'Start recording your response'
                  : 'Start recording your pronunciation'
              }
            >
              <ClassGlyph name="mic" size={28} />
            </button>
            <div className={styles.recHint}>tap to speak</div>
          </>
        )}

        {recorder.error && (
          <p className={styles.micError} role="alert">
            {recorder.error}
          </p>
        )}
        {phase === 'failed' && (
          <div className={styles.failedRow} role="alert">
            <span className={styles.failedText}>{error}</span>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={handleReset}
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {phase === 'scored' && result && (
        <div className={styles.speakOverall}>
          <ScoreDial value={overall} size={60} />
          <div className={styles.speakTip}>
            {result.feedback ??
              (overall >= 75
                ? 'Clear enough to be understood.'
                : 'A little muddy. Give it another take.')}
          </div>
          <a className={styles.feedbackLink} href={feedbackHref}>
            Go to Feedback Clinic
          </a>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={handleReset}
          >
            <ClassGlyph name="retry" size={15} /> Re-record
          </button>
        </div>
      )}
    </article>
  );
}

// ---- module ----

export function SpeakingSection({
  endpointBase,
  classBinding,
  sectionId,
  prerequisiteDirections,
  prompts,
  gate,
  nextName,
  onScore,
  onFeedback,
  feedbackHref = '#feedback-clinic',
  onContinue,
}: SpeakingSectionProps) {
  const [idx, setIdx] = useState(0);
  // overall score per prompt id (0..100)
  const [scores, setScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      prompts.flatMap((prompt) =>
        !pendingSpeakingUpload(endpointBase, prompt.id) &&
        prompt.latestRecording?.status === 'SCORED' &&
        prompt.latestRecording.overallScore != null
          ? [[prompt.id, Math.round(prompt.latestRecording.overallScore * 100)]]
          : []
      )
    )
  );

  const total = prompts.length;
  const cur = prompts[idx];
  const direction =
    cur && sectionId
      ? taskDirection(prerequisiteDirections, sectionId, cur.id, 'speaking')
      : undefined;

  const scoredValues = prompts
    .map((p) => scores[p.id])
    .filter((v): v is number => typeof v === 'number');
  const allScored = scoredValues.length === total && total > 0;
  const overall =
    scoredValues.length > 0
      ? Math.round(scoredValues.reduce((a, b) => a + b, 0) / scoredValues.length)
      : 0;
  const passed = allScored && overall >= gate;

  useEffect(() => {
    onScore(overall);
  }, [overall, onScore]);

  const handlePending = useCallback((promptId: string) => {
    setScores((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([id]) => id !== promptId))
    );
  }, []);

  const handleScored = useCallback(
    (promptId: string, result: ScoringResult) => {
      const value = Math.round((result.overallScore ?? 0) * 100);
      setScores((prev) => ({ ...prev, [promptId]: value }));
      onFeedback?.(promptId, {
        id: result.recordingId,
        status: result.status,
        transcript: result.transcript,
        overallScore: result.overallScore,
        rubricScores: result.rubricScores,
        phonemeScores: result.phonemeScores,
        feedback: result.feedback,
      });
    },
    [onFeedback]
  );

  if (total === 0) {
    return (
      <div className={styles.root}>
        <div className={styles.segEnter}>
          <div className={styles.eyebrow}>
            <span className={styles.eyebrowIdx}>03 ·</span> Speaking
          </div>
          <h1 className={styles.title}>Nothing to say yet.</h1>
          <p className={styles.modLede}>No speaking prompts were generated for this class.</p>
          <ContinueBar
            passed
            gate={gate}
            score={100}
            nextName={nextName}
            onContinue={onContinue}
            gated={false}
          />
        </div>
      </div>
    );
  }

  const curScored = cur ? typeof scores[cur.id] === 'number' : false;

  return (
    <div className={styles.root}>
      <div className={styles.segEnter}>
        <div className={styles.eyebrow}>
          <span className={styles.eyebrowIdx}>03 ·</span> Speaking
        </div>
        <h1 className={styles.title}>
          {cur?.taskMode === 'COMMUNICATIVE' ? 'Respond in your own words.' : 'Say it out loud.'}
        </h1>
        <p className={styles.modLede}>
          {cur?.taskMode === 'COMMUNICATIVE'
            ? 'Follow the task and constraints. Feedback assesses the communicative goal. Task'
            : 'Record each phrase. Feedback measures recognized words and available word timing. Phrase'}{' '}
          {idx + 1} of {total}.
        </p>

        {cur && (
          <PromptCard
            key={cur.id}
            endpointBase={endpointBase}
            classBinding={classBinding}
            prompt={cur}
            index={idx}
            total={total}
            onScored={handleScored}
            onPending={handlePending}
            feedbackHref={feedbackHref}
            direction={
              direction && prerequisiteDirections && sectionId
                ? {
                    id: `direction-${sectionId}-${cur.id}`,
                    text: direction.instruction,
                    language: prerequisiteDirections.nativeLang,
                  }
                : undefined
            }
          />
        )}

        {curScored && idx + 1 < total && (
          <div className={styles.cactions}>
            <span className={styles.grow} />
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => setIdx((i) => i + 1)}
            >
              {cur?.taskMode === 'COMMUNICATIVE' ? 'Next task' : 'Next phrase'}{' '}
              <ClassGlyph name="arrow" size={16} />
            </button>
          </div>
        )}

        {idx + 1 >= total && (
          <ContinueBar
            passed={passed}
            gate={gate}
            score={overall}
            nextName={nextName}
            onContinue={onContinue}
          />
        )}
      </div>
    </div>
  );
}
