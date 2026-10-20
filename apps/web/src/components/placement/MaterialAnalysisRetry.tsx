'use client';

import { useEffect, useRef, useState } from 'react';
import {
  retryMaterialAnalysisRequest,
  type MaterialAnalysisProjection,
} from '@/lib/course-materials/client/analysis';
import styles from './MaterialAnalysisRetry.module.css';

export function MaterialAnalysisRetry({
  analysis,
  onRetry,
}: {
  analysis: MaterialAnalysisProjection | null;
  onRetry: (analysisId: string, parentId: string) => void | Promise<void>;
}) {
  if (
    !analysis ||
    !['FAILED', 'PARTIAL', 'INSUFFICIENT_SOURCE'].includes(analysis.status) ||
    (analysis.status !== 'FAILED' && !analysis.coverage?.failedUnitIds.length)
  )
    return null;
  return <RetryControl key={analysis.analysisId} analysis={analysis} onRetry={onRetry} />;
}

function RetryControl({
  analysis,
  onRetry,
}: {
  analysis: MaterialAnalysisProjection;
  onRetry: (analysisId: string, parentId: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function retry() {
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    requestId.current ??= crypto.randomUUID();
    setBusy(true);
    setError('');
    try {
      const result = await retryMaterialAnalysisRequest({
        analysis,
        requestId: requestId.current,
        signal: current.signal,
      });
      current.signal.throwIfAborted();
      await onRetry(result.analysisId, analysis.analysisId);
    } catch (cause) {
      if (!current.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Could not start the saved retry.');
    } finally {
      if (controller.current === current) controller.current = null;
      if (!current.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className={styles.root} aria-label="Retry source analysis">
      <p>
        Successful chunks stay saved. Retrying failed chunks may send new requests to your
        configured model.
      </p>
      <button className={styles.action} type="button" disabled={busy} onClick={() => void retry()}>
        {busy ? 'Opening saved retry...' : 'Retry failed chunks'}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
