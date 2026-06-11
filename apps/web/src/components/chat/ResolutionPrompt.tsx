'use client';

import { useState } from 'react';
import styles from './ResolutionPrompt.module.css';

interface ResolutionPromptProps {
  onResolve: (resolved: boolean, incorporate: boolean) => void;
  isLoading?: boolean;
  canIncorporate?: boolean;
}

export function ResolutionPrompt({ onResolve, isLoading = false, canIncorporate = true }: ResolutionPromptProps) {
  const [step, setStep] = useState<'initial' | 'followup'>('initial');

  function handleYes() {
    if (canIncorporate) {
      setStep('followup');
    } else {
      onResolve(true, false);
    }
  }

  function handleNo() {
    onResolve(false, false);
  }

  function handleIncorporate() {
    onResolve(true, true);
  }

  function handleSkipIncorporate() {
    onResolve(true, false);
  }

  return (
    <div className={styles.root} role="region" aria-label="Resolution prompt">
      {step === 'initial' && (
        <div>
          <p className={styles.question}>Was that helpful?</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.buttonSuccess}
              onClick={handleYes}
              disabled={isLoading}
              aria-label="Yes, that helped"
            >
              {isLoading && <span className={styles.spinner} />}
              Yes, that helped
            </button>
            <button
              type="button"
              className={styles.buttonOutlined}
              onClick={handleNo}
              disabled={isLoading}
              aria-label="Not quite"
            >
              Not quite
            </button>
          </div>
        </div>
      )}
      {step === 'followup' && (
        <div className={styles.fadeIn}>
          <p className={styles.question}>Update the lesson with this explanation?</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.buttonPrimary}
              onClick={handleIncorporate}
              disabled={isLoading}
              aria-label="Yes, update the lesson"
            >
              {isLoading && <span className={styles.spinner} />}
              Yes, update
            </button>
            <button
              type="button"
              className={styles.buttonOutlined}
              onClick={handleSkipIncorporate}
              disabled={isLoading}
              aria-label="No thanks, skip updating"
            >
              No thanks
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
