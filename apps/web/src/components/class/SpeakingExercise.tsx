'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioRecorder } from '@/lib/hooks/useAudioRecorder';
import styles from './SpeakingExercise.module.css';

// ---- Types ----

interface Prompt {
  id: string;
  targetPhrase: string;
  translation: string;
  ipa?: string | null;
  referenceTtsUrl?: string | null;
}

interface RubricScores {
  accuracy?: number;
  fluency?: number;
  completeness?: number;
}

interface ScoringResult {
  recordingId: string;
  transcript?: string | null;
  overallScore?: number | null;
  rubricScores?: RubricScores | null;
  feedback?: string | null;
  status: 'PENDING' | 'GRADING' | 'SCORED' | 'FAILED';
}

type PromptPhase =
  | 'idle'
  | 'recording'
  | 'uploading'
  | 'grading'
  | 'scored'
  | 'failed';

interface PromptState {
  phase: PromptPhase;
  recordingId: string | null;
  result: ScoringResult | null;
  error: string | null;
}

interface SpeakingExerciseProps {
  /** Endpoint prefix for upload/poll, e.g. `/api/classes/{classId}/speaking`
   *  or `/api/practice/{sessionId}/speaking`. Prompt id is appended. */
  endpointBase: string;
  prompts: Prompt[];
}

// ---- Constants ----

const POLL_INTERVAL_MS = 1500;
const RUBRIC_LABELS: Record<string, string> = {
  accuracy: 'Accuracy',
  fluency: 'Fluency',
  completeness: 'Completeness',
};

// ---- PromptCard sub-component ----

interface PromptCardProps {
  endpointBase: string;
  prompt: Prompt;
  index: number;
  total: number;
}

function PromptCard({ endpointBase, prompt, index, total }: PromptCardProps) {
  const [state, setState] = useState<PromptState>({
    phase: 'idle',
    recordingId: null,
    result: null,
    error: null,
  });

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const referenceAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlayingRef, setIsPlayingRef] = useState(false);

  const recorder = useAudioRecorder({ maxSeconds: 60, minSeconds: 2 });

  // ---- Cleanup on unmount ----
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (referenceAudioRef.current) {
        referenceAudioRef.current.pause();
        referenceAudioRef.current = null;
      }
    };
  }, []);

  // ---- Upload after recording stops ----
  const uploadRecording = useCallback(
    async (blob: Blob) => {
      setState((prev) => ({ ...prev, phase: 'uploading', error: null }));

      try {
        const form = new FormData();
        form.append('audio', blob, 'recording.webm');

        const res = await fetch(
          `${endpointBase}/${prompt.id}`,
          { method: 'POST', body: form }
        );

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setState((prev) => ({
            ...prev,
            phase: 'failed',
            error: (body as { error?: string }).error ?? 'Upload failed.',
          }));
          return;
        }

        const data: { recordingId: string } = await res.json();
        setState((prev) => ({
          ...prev,
          phase: 'grading',
          recordingId: data.recordingId,
        }));
      } catch {
        setState((prev) => ({
          ...prev,
          phase: 'failed',
          error: 'A network error occurred during upload.',
        }));
      }
    },
    [endpointBase, prompt.id]
  );

  // ---- Trigger upload when blob lands ----
  useEffect(() => {
    if (!recorder.recordedBlob) return;
    void (async () => {
      await uploadRecording(recorder.recordedBlob!);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.recordedBlob]);

  // ---- Polling ----
  const pollResult = useCallback(
    async (recordingId: string) => {
      try {
        const res = await fetch(
          `${endpointBase}/${prompt.id}?recordingId=${encodeURIComponent(recordingId)}`
        );
        if (!res.ok) return;

        const data: ScoringResult = await res.json();

        if (data.status === 'SCORED' || data.status === 'FAILED') {
          setState((prev) => ({
            ...prev,
            phase: data.status === 'SCORED' ? 'scored' : 'failed',
            result: data,
            error:
              data.status === 'FAILED'
                ? 'Scoring failed. Please try again.'
                : null,
          }));
        } else {
          pollTimerRef.current = setTimeout(() => {
            void pollResult(recordingId);
          }, POLL_INTERVAL_MS);
        }
      } catch {
        pollTimerRef.current = setTimeout(() => {
          void pollResult(recordingId);
        }, POLL_INTERVAL_MS);
      }
    },
    [endpointBase, prompt.id]
  );

  useEffect(() => {
    if (state.phase !== 'grading' || !state.recordingId) return;
    void (async () => {
      await pollResult(state.recordingId!);
    })();

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [state.phase, state.recordingId, pollResult]);

  // ---- Reference audio playback ----
  function playReference() {
    if (!prompt.referenceTtsUrl) return;
    if (referenceAudioRef.current) {
      referenceAudioRef.current.pause();
    }
    const audio = new Audio(prompt.referenceTtsUrl);
    referenceAudioRef.current = audio;
    setIsPlayingRef(true);
    void audio.play();
    audio.onended = () => setIsPlayingRef(false);
    audio.onerror = () => setIsPlayingRef(false);
  }

  function stopReference() {
    if (referenceAudioRef.current) {
      referenceAudioRef.current.pause();
      referenceAudioRef.current.currentTime = 0;
    }
    setIsPlayingRef(false);
  }

  // ---- Record / stop handlers ----
  async function handleStartRecording() {
    recorder.reset();
    setState({ phase: 'recording', recordingId: null, result: null, error: null });
    await recorder.startRecording();
  }

  function handleStopRecording() {
    recorder.stopRecording();
  }

  function handleReset() {
    recorder.reset();
    setState({ phase: 'idle', recordingId: null, result: null, error: null });
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
  }

  // ---- Rubric bar ----
  function RubricBar({
    label,
    score,
  }: {
    label: string;
    score: number;
  }) {
    const pct = Math.round(score * 100);
    return (
      <div className={styles.rubricItem}>
        <div className={styles.rubricMeta}>
          <span className={styles.rubricLabel}>{label}</span>
          <span className={styles.rubricValue} aria-label={`${pct} percent`}>
            {pct}%
          </span>
        </div>
        <div
          className={styles.rubricTrack}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${pct}%`}
        >
          <div
            className={styles.rubricFill}
            style={{ '--score-pct': `${pct}%` } as React.CSSProperties}
          />
        </div>
      </div>
    );
  }

  const { phase, result, error } = state;
  const isActive = phase === 'recording';
  const isUploading = phase === 'uploading';
  const isGrading = phase === 'grading';
  const isBusy = isUploading || isGrading;

  return (
    <article
      className={`${styles.card} ${isActive ? styles.cardRecording : ''} ${phase === 'scored' ? styles.cardScored : ''}`}
      aria-label={`Speaking prompt ${index + 1} of ${total}`}
    >
      {/* Phrase header */}
      <header className={styles.phraseHeader}>
        <div className={styles.phraseIndex} aria-hidden="true">
          {index + 1}
        </div>
        <div className={styles.phraseContent}>
          <p className={styles.targetPhrase} lang="auto">
            {prompt.targetPhrase}
          </p>
          <p className={styles.translation}>{prompt.translation}</p>
          {prompt.ipa && (
            <p className={styles.ipa} aria-label={`Pronunciation: ${prompt.ipa}`}>
              {prompt.ipa}
            </p>
          )}
        </div>

        {prompt.referenceTtsUrl && (
          <button
            type="button"
            className={`${styles.playRefButton} ${isPlayingRef ? styles.playRefButtonActive : ''}`}
            onClick={isPlayingRef ? stopReference : playReference}
            aria-label={isPlayingRef ? 'Stop reference audio' : 'Play reference pronunciation'}
          >
            {isPlayingRef ? (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <polygon points="5,3 19,12 5,21" />
              </svg>
            )}
          </button>
        )}
      </header>

      {/* Recorder controls */}
      {phase !== 'scored' && (
        <div className={styles.recorderRow}>
          {phase === 'idle' && (
            <button
              type="button"
              className={styles.recordButton}
              onClick={() => void handleStartRecording()}
              aria-label="Start recording your pronunciation"
            >
              <span className={styles.recordDot} aria-hidden="true" />
              Record
            </button>
          )}

          {phase === 'recording' && (
            <>
              <div className={styles.recordingIndicator} aria-live="polite" aria-label="Recording in progress">
                <span className={styles.recordingPulse} aria-hidden="true" />
                <span className={styles.recordingLabel}>
                  Recording
                  {recorder.duration > 0 && (
                    <span className={styles.recordingTime} aria-label={`${recorder.duration} seconds`}>
                      {' '}{recorder.duration}s
                    </span>
                  )}
                </span>
              </div>
              <button
                type="button"
                className={styles.stopButton}
                onClick={handleStopRecording}
                aria-label="Stop recording"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
                Stop
              </button>
            </>
          )}

          {isBusy && (
            <div className={styles.busyRow} role="status" aria-live="polite">
              <span className={styles.spinner} aria-hidden="true" />
              <span className={styles.busyLabel}>
                {isUploading ? 'Uploading…' : 'Grading…'}
              </span>
            </div>
          )}

          {phase === 'failed' && (
            <div className={styles.failedRow} role="alert">
              <span className={styles.failedText}>{error}</span>
              <button
                type="button"
                className={styles.retryButton}
                onClick={handleReset}
                aria-label="Try recording again"
              >
                Try again
              </button>
            </div>
          )}

          {recorder.error && (
            <p className={styles.micError} role="alert">
              {recorder.error}
            </p>
          )}
        </div>
      )}

      {/* Results */}
      {phase === 'scored' && result && (
        <div className={styles.results} aria-live="polite">
          {/* Overall score */}
          {result.overallScore !== null && result.overallScore !== undefined && (
            <div className={styles.scoreRow}>
              <div
                className={styles.scoreDial}
                aria-label={`Overall score: ${Math.round(result.overallScore * 100)} percent`}
              >
                <span className={styles.scoreNumber}>
                  {Math.round(result.overallScore * 100)}
                </span>
                <span className={styles.scoreSuffix}>%</span>
              </div>
              <span className={styles.scoreLabel}>Overall</span>
            </div>
          )}

          {/* Transcript */}
          {result.transcript && (
            <div className={styles.transcriptBlock}>
              <span className={styles.transcriptHeading}>You said</span>
              <p className={styles.transcript}>&ldquo;{result.transcript}&rdquo;</p>
            </div>
          )}

          {/* Rubric bars */}
          {result.rubricScores && (
            <div className={styles.rubricList} aria-label="Skill breakdown">
              {Object.entries(result.rubricScores).map(([key, val]) => {
                if (typeof val !== 'number') return null;
                return (
                  <RubricBar
                    key={key}
                    label={RUBRIC_LABELS[key] ?? key}
                    score={val}
                  />
                );
              })}
            </div>
          )}

          {/* Feedback */}
          {result.feedback && (
            <p className={styles.feedback}>{result.feedback}</p>
          )}

          {/* Try again */}
          <button
            type="button"
            className={styles.tryAgainButton}
            onClick={handleReset}
            aria-label="Record again for this prompt"
          >
            Record again
          </button>
        </div>
      )}
    </article>
  );
}

// ---- Main export ----

export function SpeakingExercise({ endpointBase, prompts }: SpeakingExerciseProps) {
  if (!prompts.length) {
    return (
      <div className={styles.empty} role="status">
        <p className={styles.emptyText}>No speaking prompts available for this section.</p>
      </div>
    );
  }

  return (
    <section className={styles.root} aria-label="Speaking exercise">
      <header className={styles.exerciseHeader}>
        <h2 className={styles.exerciseTitle}>Speaking Practice</h2>
        <p className={styles.exerciseSubtitle}>
          Record each phrase. You&rsquo;ll receive pronunciation feedback instantly.
        </p>
      </header>

      <ol className={styles.promptList} role="list" aria-label={`${prompts.length} speaking prompts`}>
        {prompts.map((prompt, idx) => (
          <li key={prompt.id} className={styles.promptItem}>
            <PromptCard
              endpointBase={endpointBase}
              prompt={prompt}
              index={idx}
              total={prompts.length}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}
