'use client';

import { useMemo } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import styles from './GenerationProgress.module.css';

interface GenerationProgressProps {
  status: string;
  progress?: number;
  error?: string;
}

const PIPELINE_STEPS = [
  { key: 'EXTRACTING', label: 'Extracting content' },
  { key: 'SCRIPTING', label: 'Writing script' },
  { key: 'GENERATING_AUDIO', label: 'Generating audio' },
  { key: 'STITCHING', label: 'Stitching together' },
  { key: 'READY', label: 'Ready!' },
] as const;

type StepState = 'completed' | 'current' | 'future' | 'error';

export function GenerationProgress({ status, progress, error }: GenerationProgressProps) {
  const stepStates = useMemo(() => {
    const currentIndex = PIPELINE_STEPS.findIndex((step) => step.key === status);

    return PIPELINE_STEPS.map((_step, index): StepState => {
      if (currentIndex === -1) return 'future';
      if (index < currentIndex) return 'completed';
      if (index === currentIndex) return error ? 'error' : 'current';
      return 'future';
    });
  }, [status, error]);

  return (
    <div className={styles.root} role="progressbar" aria-label="Podcast generation progress">
      <ol className={styles.stepper} aria-label="Generation steps">
        {PIPELINE_STEPS.map((step, index) => {
          const state = stepStates[index];
          const isLast = index === PIPELINE_STEPS.length - 1;

          return (
            <li
              key={step.key}
              className={`${styles.step} ${styles[state]}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <div className={styles.stepRow}>
                <div className={styles.indicator}>
                  <div className={styles.circle}>
                    {state === 'completed' ? (
                      <Check size={14} strokeWidth={3} aria-hidden="true" />
                    ) : state === 'error' ? (
                      <AlertCircle size={14} strokeWidth={2.5} aria-hidden="true" />
                    ) : (
                      <span className={styles.stepNumber} aria-hidden="true">
                        {index + 1}
                      </span>
                    )}
                  </div>
                  {!isLast && <div className={styles.connector} />}
                </div>

                <div className={styles.content}>
                  <span className={styles.label}>{step.label}</span>

                  {state === 'current' && progress !== undefined && (
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

                  {state === 'error' && error && (
                    <p className={styles.errorMessage} role="alert">
                      {error}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
