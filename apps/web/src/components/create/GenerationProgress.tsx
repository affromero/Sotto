'use client';

import { useMemo } from 'react';
import { Check, AlertCircle, Pause } from 'lucide-react';
import styles from './GenerationProgress.module.css';

interface GenerationProgressProps {
  status: string;
  progress?: number;
  error?: string;
}

const PIPELINE_STEPS = [
  { key: 'EXTRACTING', label: 'Extract', fullLabel: 'Extracting content' },
  { key: 'SCRIPTING', label: 'Script', fullLabel: 'Writing script' },
  { key: 'VERIFYING_SCRIPT', label: 'Verify', fullLabel: 'Fact-checking claims' },
  { key: 'VALIDATING_REFERENCES', label: 'Refs', fullLabel: 'Verifying references' },
  { key: 'SCRIPT_READY', label: 'Review', fullLabel: 'Script ready for review' },
  { key: 'GENERATING_AUDIO', label: 'Audio', fullLabel: 'Generating audio' },
  { key: 'STITCHING', label: 'Stitch', fullLabel: 'Stitching together' },
  { key: 'READY', label: 'Done', fullLabel: 'Ready!' },
] as const;

type StepState = 'completed' | 'current' | 'future' | 'error' | 'paused';

export function GenerationProgress({ status, progress, error }: GenerationProgressProps) {
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

  return (
    <div className={styles.root} role="progressbar" aria-label="Podcast generation progress">
      {/* Progress track */}
      <div className={styles.track}>
        <div
          className={styles.trackFill}
          style={{
            width:
              currentIndex === -1
                ? '0%'
                : `${(currentIndex / (PIPELINE_STEPS.length - 1)) * 100}%`,
          }}
        />
      </div>

      {/* Step dots */}
      <ol className={styles.stepper} aria-label="Generation steps">
        {PIPELINE_STEPS.map((step, index) => {
          const state = stepStates[index];

          return (
            <li
              key={step.key}
              className={`${styles.step} ${styles[state]}`}
              aria-current={state === 'current' || state === 'paused' ? 'step' : undefined}
              aria-label={step.fullLabel}
            >
              <div className={styles.dot}>
                {state === 'completed' ? (
                  <Check size={10} strokeWidth={3} aria-hidden="true" />
                ) : state === 'error' ? (
                  <AlertCircle size={10} strokeWidth={3} aria-hidden="true" />
                ) : state === 'paused' ? (
                  <Pause size={10} strokeWidth={3} aria-hidden="true" />
                ) : (
                  <span className={styles.dotNumber} aria-hidden="true">
                    {index + 1}
                  </span>
                )}
              </div>
              <span className={styles.label}>{step.label}</span>
            </li>
          );
        })}
      </ol>

      {/* Active step detail */}
      {currentStep && (
        <div className={styles.detail}>
          <span
            className={`${styles.detailLabel} ${currentState === 'error' ? styles.detailError : currentState === 'paused' ? styles.detailPaused : ''}`}
          >
            {currentStep.fullLabel}
          </span>

          {currentState === 'current' && progress !== undefined && (
            <div className={styles.progressWrap}>
              <div className={styles.progressTrack}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
                />
              </div>
              <span className={styles.progressText}>{Math.round(progress)}%</span>
            </div>
          )}

          {currentState === 'error' && error && (
            <p className={styles.errorMessage} role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
