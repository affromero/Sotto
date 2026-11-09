'use client';

import { useState } from 'react';
import styles from './SpeakingRecoveryNotice.module.css';

interface Props {
  endpointBase: string;
  promptId: string;
  recordingId: string | null;
  acknowledged: boolean;
  onAcknowledged: () => void;
  onRetry: () => void;
}

export function SpeakingRecoveryNotice({
  endpointBase,
  promptId,
  recordingId,
  acknowledged,
  onAcknowledged,
  onRetry,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `${endpointBase}/${encodeURIComponent(promptId)}`;
  const supported = endpointBase.startsWith('/api/v1/classes/') && recordingId !== null;

  async function acknowledge() {
    if (!recordingId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${url}/recovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordingId, acknowledgePossibleCharges: true }),
      });
      if (!response.ok) {
        setError(
          'Recovery is not ready. Review the teaching and ask your server administrator to confirm cleanup.'
        );
        return;
      }
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== 'object' ||
        !('acknowledged' in body) ||
        body.acknowledged !== true
      )
        throw new Error('The acknowledgment could not be confirmed. Check saved recording.');
      setConfirming(false);
      onAcknowledged();
    } catch {
      setError('The acknowledgment could not be confirmed. Check saved recording.');
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (!recordingId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${url}?recordingId=${encodeURIComponent(recordingId)}`);
      if (!response.ok) throw new Error('Saved recording could not be checked.');
      const body: unknown = await response.json();
      if (
        body &&
        typeof body === 'object' &&
        'status' in body &&
        body.status === 'UNRESOLVED' &&
        'recoveryAcknowledged' in body &&
        body.recoveryAcknowledged === true
      )
        onAcknowledged();
      else setError('The acknowledgment has not been confirmed.');
    } catch {
      setError('Saved recording could not be checked.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.root} role="alert">
      <p>The grading outcome is unknown. Your recording is saved.</p>
      {acknowledged ? (
        <button type="button" onClick={onRetry}>
          Start a new attempt
        </button>
      ) : supported ? (
        <>
          {confirming ? (
            <>
              <p>
                The earlier provider request may still complete or incur a charge. A new attempt may
                incur another charge.
              </p>
              <button type="button" disabled={busy} onClick={() => void acknowledge()}>
                I understand, continue
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => setConfirming(true)}>
              Review another attempt
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void check()}>
            Check saved recording
          </button>
          <p>If recovery is not ready, ask your server administrator to confirm cleanup.</p>
        </>
      ) : (
        <p>Contact your server administrator before another attempt.</p>
      )}
      {error && <p>{error}</p>}
    </div>
  );
}
