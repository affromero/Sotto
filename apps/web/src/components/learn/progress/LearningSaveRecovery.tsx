'use client';

import { useState } from 'react';
import {
  archiveClassWork,
  discardClassWork,
  reconcileLearningProgress,
} from './useLearningProgress';
import styles from './LearningSaveRecovery.module.css';
import { retainedClassWork } from './useLearningProgress';

export function RetainedClassWork({
  endpoint,
  attempt,
  onArchived,
}: {
  endpoint: string;
  attempt: string;
  onArchived?: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [failure, setFailure] = useState('');
  const [discard, setDiscard] = useState(false);
  const retained = retainedClassWork(endpoint, attempt);
  if (!retained.length) return null;
  return (
    <section className={styles.root} aria-label="Retained class work">
      <p>These unsaved edits are available to copy here.</p>
      {retained.map(
        ({ attempt: originalAttempt, pending, answerContext, blocksCurrent }, index) => (
          <div key={`${originalAttempt}-${index}`}>
            <p>Class attempt {originalAttempt}</p>
            {Object.entries(pending.answers ?? {}).map(([id, answer]) => (
              <p key={id}>
                {answerContext[id]
                  ? `${answerContext[id].question}: ${answerContext[id].option}`
                  : `Question ${id}: option ${answer + 1}`}
              </p>
            ))}
            {Object.entries(pending.writingDrafts ?? {}).map(([id, draft]) => (
              <div key={id}>
                <p>Writing {id}</p>
                <pre>{draft}</pre>
              </div>
            ))}
            {blocksCurrent && onArchived && (
              <>
                {confirm && (
                  <p>
                    A copy will remain in this browser tab. Start the current class with its saved
                    server work?
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm) {
                      setConfirm(true);
                      return;
                    }
                    try {
                      archiveClassWork(endpoint, originalAttempt);
                      onArchived();
                    } catch (cause: unknown) {
                      setFailure(
                        cause instanceof Error ? cause.message : 'The edits could not be retained.'
                      );
                    }
                  }}
                >
                  {confirm ? 'Keep copy and continue' : 'Continue with current class'}
                </button>
                {failure && (
                  <>
                    {discard && (
                      <p>
                        This removes the current copy permanently. Copy your work first. If browser
                        storage is unavailable, an older copy may reappear when access returns.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (!discard) {
                          setDiscard(true);
                          return;
                        }
                        try {
                          discardClassWork(endpoint, originalAttempt);
                          onArchived();
                        } catch (cause: unknown) {
                          setFailure(
                            cause instanceof Error
                              ? cause.message
                              : 'The edits could not be removed.'
                          );
                        }
                      }}
                    >
                      {discard ? 'Delete copy and continue' : 'I copied my work'}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )
      )}
      {failure && <p role="alert">{failure}</p>}
    </section>
  );
}

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
