'use client';

import { useMemo } from 'react';
import { Check, AlertCircle, Pause, ShieldCheck } from 'lucide-react';
import { useRotatingMessage } from '@/lib/hooks/useRotatingMessage';
import { SottoSpinner } from '@/components/ui/SottoSpinner';
import { getVerificationStandardUrl } from '@/lib/public-links';
import type { VerificationProgressSnapshot } from '@/types/episode';
import styles from './GenerationProgress.module.css';

const COMPILE_STAGES = new Set(['COMPILING']);

interface GenerationProgressProps {
  status: string;
  progress?: number;
  error?: string;
  topic?: string;
  verificationProgress?: VerificationProgressSnapshot | null;
}

const PIPELINE_STEPS = [
  { key: 'EXTRACTING', label: 'Reading your source material' },
  { key: 'RESEARCHING', label: 'Researching the topic' },
  { key: 'PLANNING', label: 'Planning the narrative' },
  { key: 'SCRIPTING', label: 'Writing your lesson script' },
  { key: 'COMPILING', label: 'Verifying citations' },
  { key: 'SCRIPT_READY', label: 'Your script is ready for review' },
  { key: 'GENERATING_AUDIO', label: 'Recording the voices' },
  { key: 'STITCHING', label: 'Mixing the final audio' },
  { key: 'READY', label: 'Your lesson is ready!' },
] as const;

type StepState = 'completed' | 'current' | 'future' | 'error' | 'paused';

function getVerificationMessage(vp: VerificationProgressSnapshot): string | null {
  if (vp.phase === 'checking' && vp.checked > 0) {
    return `Checked ${vp.checked} of ${vp.total} references...`;
  }
  if (vp.phase === 'replacing') {
    return `${vp.verified} verified, ${vp.removed + vp.rejected} need replacement. Searching for better sources (attempt ${vp.attempt} of ${vp.maxAttempts})...`;
  }
  if (vp.phase === 'complete') {
    return `All ${vp.total} references verified`;
  }
  return null;
}

export function GenerationProgress({
  status,
  progress,
  error,
  topic,
  verificationProgress,
}: GenerationProgressProps) {
  const verificationStandardUrl = getVerificationStandardUrl();
  const currentIndex = useMemo(
    () => PIPELINE_STEPS.findIndex((step) => step.key === status),
    [status]
  );

  const stepStates = useMemo(() => {
    return PIPELINE_STEPS.map((step, index): StepState => {
      if (currentIndex === -1) return 'future';
      if (index < currentIndex) return 'completed';
      if (index === currentIndex) {
        if (error) return 'error';
        if (step.key === 'SCRIPT_READY') return 'paused';
        return 'current';
      }
      return 'future';
    });
  }, [currentIndex, error]);

  const currentStep = currentIndex >= 0 ? PIPELINE_STEPS[currentIndex] : null;
  const currentState = currentIndex >= 0 ? stepStates[currentIndex] : null;
  const isActive = currentState === 'current';
  const isDone = currentStep?.key === 'READY';

  const { message: rotatingMessage, transitionKey } = useRotatingMessage({
    status,
    topic,
    isActive,
  });

  // Override sub-message and progress with real-time verification data
  const vpMessage =
    verificationProgress && status === 'COMPILING'
      ? getVerificationMessage(verificationProgress)
      : null;
  const subMessage = vpMessage ?? rotatingMessage;
  const derivedProgress =
    verificationProgress && status === 'COMPILING' && verificationProgress.total > 0
      ? Math.round((verificationProgress.checked / verificationProgress.total) * 100)
      : progress;

  return (
    <div className={styles.root} role="progressbar" aria-label="Lesson generation progress">
      {/* Animated orb */}
      <div
        className={`${styles.orbWrap} ${
          currentState === 'error'
            ? styles.orbError
            : currentState === 'paused'
              ? styles.orbPaused
              : isDone
                ? styles.orbDone
                : ''
        }`}
      >
        {isActive && (
          <>
            <div className={`${styles.ring} ${styles.ring1}`} />
            <div className={`${styles.ring} ${styles.ring2}`} />
            <div className={`${styles.ring} ${styles.ring3}`} />
          </>
        )}
        <div className={`${styles.orb} ${isActive ? styles.orbActive : ''}`}>
          {currentState === 'error' ? (
            <AlertCircle size={24} strokeWidth={2} aria-hidden="true" />
          ) : currentState === 'paused' ? (
            <Pause size={24} strokeWidth={2} aria-hidden="true" />
          ) : isDone ? (
            <Check size={24} strokeWidth={2.5} aria-hidden="true" />
          ) : derivedProgress !== undefined && isActive ? (
            <span className={styles.orbPercent}>{Math.round(derivedProgress)}%</span>
          ) : (
            <SottoSpinner className={styles.orbLottie} />
          )}
        </div>
      </div>

      {/* Status text */}
      {currentStep && (
        <div className={styles.statusText}>
          <span
            className={`${styles.statusLabel} ${
              currentState === 'error'
                ? styles.statusError
                : currentState === 'paused'
                  ? styles.statusPaused
                  : isDone
                    ? styles.statusDone
                    : ''
            }`}
          >
            {currentStep.label}
            {isActive && (
              <span className={styles.wave} aria-hidden="true">
                <span className={styles.waveBar} />
                <span className={styles.waveBar} />
                <span className={styles.waveBar} />
                <span className={styles.waveBar} />
              </span>
            )}
          </span>

          {isActive && (
            <span className={styles.stepCount}>
              Step {currentIndex + 1} of {PIPELINE_STEPS.length}
            </span>
          )}

          {subMessage && (
            <span key={transitionKey} className={styles.subMessage} aria-live="polite">
              {subMessage}
            </span>
          )}

          {isActive && COMPILE_STAGES.has(status) && verificationStandardUrl && (
            <a
              href={verificationStandardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.verifyBadge}
              aria-label="We don't ship hallucinations. View the open verification standard on GitHub"
            >
              <ShieldCheck size={14} strokeWidth={2} aria-hidden="true" />
              We don&apos;t ship hallucinations
            </a>
          )}
        </div>
      )}

      {/* Dot tracker */}
      <ol className={styles.dots} aria-label="Generation steps">
        {PIPELINE_STEPS.map((step, index) => {
          const state = stepStates[index];
          return (
            <li
              key={step.key}
              className={`${styles.dot} ${styles[`dot_${state}`]}`}
              aria-current={state === 'current' || state === 'paused' ? 'step' : undefined}
              aria-label={step.label}
            />
          );
        })}
      </ol>

      {/* Progress bar (when percentage is available) */}
      {isActive && derivedProgress !== undefined && (
        <div className={styles.progressWrap}>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{ width: `${Math.min(Math.max(derivedProgress, 0), 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Error message */}
      {currentState === 'error' && error && (
        <p className={styles.errorMessage} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
