'use client';

import { useState } from 'react';
import { reconcileLearningProgress } from './useLearningProgress';
import styles from './LearningSaveRecovery.module.css';

export function LearningSaveRecovery({
  endpoint,
  material = '',
  error,
}: {
  endpoint: string;
  material?: string;
  error: string;
}) {
  const [conflict, setConflict] = useState(false);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState('');
  if (!error) return null;
  const check = async () => {
    setChecking(true);
    setFailure('');
    try {
      const result = await reconcileLearningProgress(endpoint, material, conflict);
      setConflict(result === 'conflict');
    } catch (cause: unknown) {
      setFailure(cause instanceof Error ? cause.message : 'Saved progress could not be checked.');
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className={styles.root} role="alert">
      <p>{failure || error}</p>
      {conflict && (
        <p>
          The server has different edits. Saving your local edits will replace the competing values
          for the questions and drafts you changed.
        </p>
      )}
      <button type="button" disabled={checking} onClick={() => void check()}>
        {checking ? 'Checking…' : conflict ? 'Save my local edits' : 'Check saved progress'}
      </button>
    </div>
  );
}
