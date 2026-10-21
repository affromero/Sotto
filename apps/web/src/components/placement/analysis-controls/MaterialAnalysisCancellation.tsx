'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  materialAnalysisCancellationRequestSchema,
  materialAnalysisCancellationResponseSchema,
  type MaterialAnalysisCancellationResponse,
} from '@sotto/shared';
import type { MaterialAnalysisProjection } from '@/lib/course-materials/client/analysis';
import styles from '../MaterialAnalysisRetry.module.css';

export function MaterialAnalysisCancellation({
  analysis,
  expectedProfileId,
}: {
  analysis: MaterialAnalysisProjection | null;
  expectedProfileId?: string;
}) {
  if (
    !analysis ||
    ['COMPLETE', 'PARTIAL', 'INSUFFICIENT_SOURCE', 'SUPERSEDED'].includes(analysis.status)
  )
    return null;
  return (
    <CancellationControl
      key={JSON.stringify([
        analysis.analysisId,
        analysis.analysisRevision,
        analysis.identityDigest,
        analysis.resultDigest,
        expectedProfileId,
      ])}
      analysis={analysis}
      expectedProfileId={expectedProfileId}
    />
  );
}

function CancellationControl({
  analysis,
  expectedProfileId,
}: {
  analysis: MaterialAnalysisProjection;
  expectedProfileId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<MaterialAnalysisCancellationResponse | null>(null);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const intent = useRef<{ body: string; profileId: string } | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function cancel() {
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError('');
    try {
      if (!intent.current) {
        const response = await fetch('/api/v1/users/me', {
          signal: current.signal,
          cache: 'no-store',
          ...(expectedProfileId
            ? { headers: { 'x-sotto-expected-profile-id': expectedProfileId } }
            : {}),
        });
        if (!response.ok)
          throw new Error('Could not verify the active learner. Reopen this analysis.');
        const profile = z.object({ id: z.string().min(1) }).parse(await response.json());
        current.signal.throwIfAborted();
        if (expectedProfileId && profile.id !== expectedProfileId)
          throw new Error('The active learner changed. Reopen this analysis before cancelling.');
        const body = materialAnalysisCancellationRequestSchema.parse({
          schemaVersion: 1,
          requestId: crypto.randomUUID(),
          analysisRevision: analysis.analysisRevision,
          identityDigest: analysis.identityDigest,
          resultDigest: analysis.resultDigest,
        });
        intent.current = { profileId: profile.id, body: JSON.stringify(body) };
      }
      for (let page = 0; page < 8; page++) {
        current.signal.throwIfAborted();
        const response = await fetch(
          `/api/v1/material-analyses/${analysis.analysisId}/cancellation`,
          {
            method: 'POST',
            cache: 'no-store',
            signal: current.signal,
            headers: {
              'Content-Type': 'application/json',
              'x-sotto-expected-profile-id': intent.current.profileId,
            },
            body: intent.current.body,
          }
        );
        const body: unknown = await response.json();
        if (!response.ok) {
          const failure = z.object({ error: z.string() }).safeParse(body);
          throw new Error(
            failure.success ? failure.data.error : 'Could not read the cancellation receipt.'
          );
        }
        const result = materialAnalysisCancellationResponseSchema.parse(body);
        if (
          result.analysisId !== analysis.analysisId ||
          result.analysisRevision !== analysis.analysisRevision ||
          result.identityDigest !== analysis.identityDigest ||
          result.resultDigest !== analysis.resultDigest
        )
          throw new Error('The cancellation receipt does not match this source analysis.');
        current.signal.throwIfAborted();
        setReceipt(result);
        if (!result.cancellation.hasMore) break;
      }
    } catch (cause) {
      if (!current.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Cancellation could not be confirmed.');
    } finally {
      if (controller.current === current) controller.current = null;
      if (!current.signal.aborted) setBusy(false);
    }
  }
  const cancelled = receipt?.cancellation.state === 'CANCELLED' || analysis.status === 'CANCELLED';
  return (
    <section className={styles.root} aria-label="Stop source analysis">
      <p>
        Stop future analysis requests. An already admitted model request may still finish. Uploaded
        originals stay saved.
      </p>
      {!cancelled && (
        <button
          className={styles.action}
          type="button"
          disabled={busy}
          onClick={() => void cancel()}
        >
          {busy
            ? 'Checking cancellation...'
            : receipt || analysis.status === 'CANCELLING'
              ? 'Check cancellation status'
              : 'Cancel source analysis'}
        </button>
      )}
      {cancelled && (
        <p role="status">Source analysis cancelled. Its known work and cleanup are verified.</p>
      )}
      {receipt?.cancellation.state === 'NOT_NEEDED' && (
        <p role="status">The analysis already finished. Its saved result remains available.</p>
      )}
      {receipt?.cancellation.state === 'PENDING' && (
        <p role="status">
          Future requests are stopped.{' '}
          {receipt.cancellation.hasMore
            ? 'More saved cleanup proofs remain. Check again to continue.'
            : 'A provider outcome or cleanup is still unconfirmed. Check again after it settles.'}
        </p>
      )}
      {error && <p role="alert">{error} Retry preserves the same cancellation request.</p>}
    </section>
  );
}
