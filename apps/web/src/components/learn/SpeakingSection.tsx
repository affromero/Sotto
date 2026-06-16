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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioRecorder } from '@/lib/hooks/useAudioRecorder';
import { ClassGlyph } from './ClassGlyph';
import { ContinueBar, ScoreDial } from './ClassWidgets';
import type { ClassSpeakingPrompt } from './classTypes';
import styles from './SpeakingSection.module.css';

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
}

interface ScoringResult {
  recordingId: string;
  transcript?: string | null;
  overallScore?: number | null;
  rubricScores?: RubricScores | null;
  feedback?: string | null;
  status: 'PENDING' | 'GRADING' | 'SCORED' | 'FAILED';
}

type CardPhase = 'idle' | 'recording' | 'uploading' | 'grading' | 'scored' | 'failed';

interface CardState {
  phase: CardPhase;
  recordingId: string | null;
  result: ScoringResult | null;
  error: string | null;
}

interface SpeakingSectionProps {
  endpointBase: string;
  prompts: ClassSpeakingPrompt[];
  gate: number; // 0..100
  nextName: string | null;
  /** Report the running 0..100 average overall score upward. */
  onScore: (score: number) => void;
  onContinue: () => void;
}

// ---- one prompt card ----

interface PromptCardProps {
  endpointBase: string;
  prompt: ClassSpeakingPrompt;
  index: number;
  total: number;
  onScored: (promptId: string, overall: number) => void;
}

function PromptCard({ endpointBase, prompt, index, total, onScored }: PromptCardProps) {
  const [state, setState] = useState<CardState>({
    phase: 'idle',
    recordingId: null,
    result: null,
    error: null,
  });
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorder = useAudioRecorder({ maxSeconds: 60, minSeconds: 2 });

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const uploadRecording = useCallback(
    async (blob: Blob) => {
      setState((prev) => ({ ...prev, phase: 'uploading', error: null }));
      try {
        const form = new FormData();
        form.append('audio', blob, 'recording.webm');
        const res = await fetch(`${endpointBase}/${prompt.id}`, { method: 'POST', body: form });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setState((prev) => ({
            ...prev,
            phase: 'failed',
            error: body.error ?? 'Upload failed.',
          }));
          return;
        }
        const data = (await res.json()) as { recordingId: string };
        setState((prev) => ({ ...prev, phase: 'grading', recordingId: data.recordingId }));
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

  // Upload once the recorded blob lands.
  useEffect(() => {
    if (!recorder.recordedBlob) return;
    const blob = recorder.recordedBlob;
    void (async () => {
      await uploadRecording(blob);
    })();
  }, [recorder.recordedBlob, uploadRecording]);

  const pollResult = useCallback(
    (recordingId: string) => {
      // Self-contained polling loop: `tick` reschedules itself rather than the
      // memoized callback, so the callback never references its own identity.
      const tick = async () => {
        try {
          const res = await fetch(
            `${endpointBase}/${prompt.id}?recordingId=${encodeURIComponent(recordingId)}`
          );
          if (!res.ok) {
            pollTimerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
            return;
          }
          const data = (await res.json()) as ScoringResult;
          if (data.status === 'SCORED' || data.status === 'FAILED') {
            setState((prev) => ({
              ...prev,
              phase: data.status === 'SCORED' ? 'scored' : 'failed',
              result: data,
              error: data.status === 'FAILED' ? 'Scoring failed. Please try again.' : null,
            }));
            if (data.status === 'SCORED' && typeof data.overallScore === 'number') {
              onScored(prompt.id, Math.round(data.overallScore * 100));
            }
          } else {
            pollTimerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
          }
        } catch {
          pollTimerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
        }
      };
      void tick();
    },
    [endpointBase, prompt.id, onScored]
  );

  useEffect(() => {
    if (state.phase !== 'grading' || !state.recordingId) return;
    pollResult(state.recordingId);
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [state.phase, state.recordingId, pollResult]);

  async function handleStart() {
    recorder.reset();
    setState({ phase: 'recording', recordingId: null, result: null, error: null });
    await recorder.startRecording();
  }

  function handleStop() {
    recorder.stopRecording();
  }

  function handleReset() {
    recorder.reset();
    setState({ phase: 'idle', recordingId: null, result: null, error: null });
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
  }

  const { phase, result, error } = state;
  const overall = result?.overallScore != null ? Math.round(result.overallScore * 100) : 0;
  const rubric = result?.rubricScores ?? null;
  const isBusy = phase === 'uploading' || phase === 'grading';

  return (
    <article className={styles.speakCard} aria-label={`Speaking prompt ${index + 1} of ${total}`}>
      <div className={styles.speakTarget} lang="auto">
        {prompt.targetPhrase}
      </div>
      <div className={styles.speakEn}>{prompt.translation}</div>
      {prompt.ipa && (
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
            <span className={styles.spinner} aria-hidden="true" />
            <span className={styles.recHint}>
              {phase === 'uploading' ? 'uploading…' : 'grading…'}
            </span>
          </div>
        ) : phase === 'scored' && result ? (
          <div className={styles.scoredZone}>
            <div className={styles.phoneme} role="group" aria-label="Pronunciation breakdown">
              {RUBRIC_AXES.map((axis) => {
                const raw = rubric?.[axis.key];
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
          </div>
        ) : (
          <>
            <button
              type="button"
              className={styles.recBtn}
              onClick={() => void handleStart()}
              aria-label="Start recording your pronunciation"
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
  prompts,
  gate,
  nextName,
  onScore,
  onContinue,
}: SpeakingSectionProps) {
  const [idx, setIdx] = useState(0);
  // overall score per prompt id (0..100)
  const [scores, setScores] = useState<Record<string, number>>({});

  const total = prompts.length;
  const cur = prompts[idx];

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

  const handleScored = useCallback((promptId: string, value: number) => {
    setScores((prev) => ({ ...prev, [promptId]: value }));
  }, []);

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
        <h1 className={styles.title}>Say it out loud.</h1>
        <p className={styles.modLede}>
          Speak the line; the recognizer you chose scores accuracy, fluency, and completeness so you
          know where the sound drifts. Phrase {idx + 1} of {total}.
        </p>

        {cur && (
          <PromptCard
            key={cur.id}
            endpointBase={endpointBase}
            prompt={cur}
            index={idx}
            total={total}
            onScored={handleScored}
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
              Next phrase <ClassGlyph name="arrow" size={16} />
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
