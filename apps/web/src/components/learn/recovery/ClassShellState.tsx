'use client';

import { SottoSpinner } from '@/components/ui/SottoSpinner';
import { ClassNavigation } from '../navigation/ClassNavigation';
import { RetainedClassWork } from '../progress/LearningSaveRecovery';
import styles from '../ClassShell.module.css';

export function ClassLoadingState({ autoRefreshing }: { autoRefreshing: boolean }) {
  return (
    <div className={styles.stateShell}>
      <ClassNavigation currentSection="Loading class" />
      <div className={styles.fullState} role="status" aria-label="Loading class">
        <SottoSpinner
          size="large"
          label={autoRefreshing ? 'Preparing this class' : 'Loading your class'}
          orientation="stack"
        />
      </div>
    </div>
  );
}

export function ClassErrorState({
  classId,
  errorMessage,
  regenerating,
  onRegenerate,
  onBack,
  onRetry,
}: {
  classId: string;
  errorMessage: string;
  regenerating: boolean;
  onRegenerate: () => void;
  onBack: () => void;
  onRetry: () => void;
}) {
  const returnToLearn =
    errorMessage.includes('required material was ready') ||
    errorMessage.includes('The class changed.');
  const canRegenerate = errorMessage.includes('missing required presentation material');
  return (
    <div className={styles.stateShell}>
      <ClassNavigation currentSection="Class unavailable" />
      <div className={styles.fullState} role="alert">
        <p>{errorMessage || 'An unexpected error occurred.'}</p>
        <RetainedClassWork endpoint={`/api/v1/classes/${classId}`} attempt="" />
        {canRegenerate ? (
          <button
            type="button"
            className={styles.retryBtn}
            onClick={onRegenerate}
            disabled={regenerating}
            aria-busy={regenerating}
          >
            {regenerating ? 'Regenerating...' : 'Regenerate class'}
          </button>
        ) : null}
        <button
          type="button"
          className={styles.retryBtn}
          onClick={returnToLearn || canRegenerate ? onBack : onRetry}
        >
          {returnToLearn ? 'View progress in Learn' : canRegenerate ? 'Back to Learn' : 'Try again'}
        </button>
      </div>
    </div>
  );
}

export function ClassRecoveryState({
  endpoint,
  attempt,
  saveError,
  onArchived,
  onRetry,
}: {
  endpoint: string;
  attempt: string;
  saveError: string;
  onArchived: () => void;
  onRetry: () => void;
}) {
  return (
    <div className={styles.stateShell}>
      <ClassNavigation currentSection="Class work recovery" />
      <main className={styles.fullState}>
        <p role="alert">
          {saveError || 'Class material could not be verified. Your local work is retained.'}
        </p>
        <RetainedClassWork endpoint={endpoint} attempt={attempt} onArchived={onArchived} />
        <button type="button" onClick={onRetry}>
          Check class again
        </button>
      </main>
    </div>
  );
}
