'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  materialProcessingSchema,
  recognitionOptionsSchema,
  recognitionReceiptSchema,
  optimizationReceiptSchema,
  materialResponse,
  type MaterialProcessing,
  type RecognitionOptions,
} from '@/lib/course-materials/client/processing-contracts';
import { MaterialPageText } from './MaterialPageText';
import styles from './MaterialProcessingPanel.module.css';

interface Props {
  materialId: string;
  name: string;
  mimeType: string;
}
const visualLabels: Record<string, string> = {
  UNASSESSED: 'Visual content not assessed',
  UNAVAILABLE: 'Visual recognition unavailable',
  TEXT_SOURCE: 'Complete text source',
  RECOGNITION_NEEDED: 'Visual recognition needed',
  TEXT_COVERED: 'Visible text covered',
  RECOGNIZED: 'Visual content recognized',
  BLANK: 'Assessed as blank',
  UNCERTAIN: 'Recognition has uncertainty',
  FAILED: 'Visual recognition failed',
};
const running = (value: MaterialProcessing) =>
  ['PENDING', 'QUEUED', 'EXTRACTING'].includes(value.status) ||
  (!!value.run && ['PENDING', 'EXTRACTING'].includes(value.run.status)) ||
  value.optimization?.status === 'QUEUED';

/** A private page ledger. Reading status never authorizes model calls. */
export function MaterialProcessingPanel(props: Props) {
  return <OwnedMaterialProcessing key={props.materialId} {...props} />;
}

function OwnedMaterialProcessing({ materialId, name, mimeType }: Props) {
  const [status, setStatus] = useState<MaterialProcessing | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<RecognitionOptions | null>(null);
  const [consent, setConsent] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const query = useRef<AbortController | null>(null);
  const [recognitionRequest, setRecognitionRequest] = useState<{
    schemaVersion: 1;
    requestId: string;
    expectedProcessingRevision: number;
    capabilitySha256: string;
  } | null>(null);
  const isPdf = mimeType === 'application/pdf' || /\.pdf$/i.test(name);

  const read = useCallback(async () => {
    query.current?.abort();
    const controller = new AbortController();
    query.current = controller;
    try {
      const result = materialProcessingSchema.parse(
        await materialResponse(
          await fetch(`/api/v1/materials/${materialId}/processing`, {
            signal: controller.signal,
            cache: 'no-store',
          })
        )
      );
      if (result.materialId !== materialId)
        throw new Error('The material status identity changed.');
      if (!controller.signal.aborted) {
        setStatus(result);
        setError('');
      }
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'Could not read material status.');
    }
  }, [materialId]);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void (async () => {
      await read();
    })();
    return () => {
      controller.abort();
      query.current?.abort();
    };
  }, [read]);
  useEffect(() => {
    if (!status || !running(status)) return;
    const timer = setTimeout(() => void read(), 4_000);
    return () => clearTimeout(timer);
  }, [status, read]);

  async function morePages() {
    if (!status?.nextPage) return;
    const expected = status;
    query.current?.abort();
    const controller = new AbortController();
    query.current = controller;
    setBusy(true);
    try {
      const next = materialProcessingSchema.parse(
        await materialResponse(
          await fetch(`/api/v1/materials/${materialId}/processing?afterPage=${expected.nextPage}`, {
            signal: controller.signal,
            cache: 'no-store',
          })
        )
      );
      if (
        next.materialId !== materialId ||
        next.processingRevision !== expected.processingRevision ||
        next.run?.id !== expected.run?.id
      )
        throw new Error('The processing run changed. Refresh before reading more pages.');
      if (
        next.pages.some((page) => page.pageNumber <= expected.nextPage!) ||
        (next.nextPage !== null && next.nextPage <= expected.nextPage!)
      )
        throw new Error('The page ledger did not advance. Refresh material status.');
      if (!controller.signal.aborted)
        setStatus({ ...next, pages: [...expected.pages, ...next.pages] });
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'Could not read more pages.');
    } finally {
      setBusy(false);
    }
  }

  async function reviewRecognition() {
    setBusy(true);
    setError('');
    try {
      const reviewed = recognitionOptionsSchema.parse(
        await materialResponse(
          await fetch(`/api/v1/materials/${materialId}/recognize`, {
            signal: lifetime.current?.signal,
            cache: 'no-store',
          })
        )
      );
      if (reviewed.expectedProcessingRevision !== status?.processingRevision)
        throw new Error('The processing revision changed. Refresh before reviewing recognition.');
      setOptions(reviewed);
      setConsent(false);
    } catch (failure) {
      if (!lifetime.current?.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'Recognition is unavailable.');
    } finally {
      setBusy(false);
    }
  }

  async function recognize() {
    if (!options || !consent) return;
    const submitted = recognitionRequest ?? {
      schemaVersion: 1,
      requestId: crypto.randomUUID(),
      expectedProcessingRevision: options.expectedProcessingRevision,
      capabilitySha256: options.capabilitySha256,
    };
    setRecognitionRequest(submitted);
    setBusy(true);
    setError('');
    try {
      const receipt = recognitionReceiptSchema.parse(
        await materialResponse(
          await fetch(`/api/v1/materials/${materialId}/recognize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(submitted),
            signal: lifetime.current?.signal,
          })
        )
      );
      if (
        receipt.materialId !== materialId ||
        receipt.requestId !== submitted.requestId ||
        receipt.processingRevision !== submitted.expectedProcessingRevision + 1
      )
        throw new Error('The recognition receipt does not match the reviewed request.');
      setNotice(
        `Recognition admitted as processing revision ${receipt.processingRevision}. Request ${receipt.requestId}.`
      );
      setOptions(null);
      setConsent(false);
      await read();
    } catch (failure) {
      if (!lifetime.current?.signal.aborted)
        setError(
          `${failure instanceof Error ? failure.message : 'Recognition request failed.'} Saved request ${submitted.requestId}. Retrying this request reuses its receipt.`
        );
    } finally {
      setBusy(false);
    }
  }

  async function optimize() {
    setBusy(true);
    setError('');
    try {
      const receipt = optimizationReceiptSchema.parse(
        await materialResponse(
          await fetch(`/api/v1/materials/${materialId}/optimize`, {
            method: 'POST',
            signal: lifetime.current?.signal,
          })
        )
      );
      setNotice(
        `PDF optimization: ${receipt.status.toLowerCase()}. ${receipt.diagnostic ?? 'The original stays retained.'}`
      );
      await read();
    } catch (failure) {
      if (!lifetime.current?.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : 'Could not request PDF optimization.'
        );
    } finally {
      setBusy(false);
    }
  }

  const unknown =
    status?.status === 'RECOVERY_REQUIRED' ||
    status?.run?.status === 'RECOVERY_REQUIRED' ||
    status?.pages.some(
      (page) => page.recognition?.status === 'UNKNOWN' || page.recognition?.status === 'DISPATCHING'
    );
  const canRecognize =
    status &&
    ['COMPLETE', 'PARTIAL'].includes(status.run?.status ?? '') &&
    !unknown &&
    status.optimization?.status !== 'QUEUED';
  return (
    <section className={styles.root} aria-label={`Processing ${name}`}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Source document</p>
          <h3>{name}</h3>
        </div>
        <button type="button" onClick={() => void read()}>
          Refresh processing
        </button>
      </header>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!status && !error && <p role="status">Reading retained material status</p>}
      {status && (
        <>
          <p className={styles.meta}>
            Revision {status.processingRevision} · {status.status.toLowerCase()} ·{' '}
            {status.run?.pageCount === null || !status.run
              ? 'Page count not established'
              : `${status.run.pageCount.toLocaleString()} pages`}
          </p>
          {status.diagnostic && <p role="status">{status.diagnostic}</p>}
          <p className={styles.note}>
            Embedded text and visual recognition have separate coverage. Missing extracted text does
            not establish a blank page.
          </p>
          <div className={styles.actions}>
            <a href={`/api/v1/materials/${materialId}/file?variant=original`}>Download original</a>
            {status.optimization?.status === 'OPTIMIZED' &&
              status.optimization.originalSha256 === status.originalSha256 && (
                <a href={`/api/v1/materials/${materialId}/file?variant=optimized`}>
                  Download verified optimized PDF
                </a>
              )}
            {isPdf && !status.optimization && (
              <button type="button" disabled={busy || !!unknown} onClick={() => void optimize()}>
                Try lossless PDF compression
              </button>
            )}
          </div>
          {status.optimization && (
            <p className={styles.note}>
              Optimization: {status.optimization.status.toLowerCase()}.{' '}
              {status.optimization.diagnostic}{' '}
              {status.optimization.savedBytes
                ? `${status.optimization.savedBytes.toLocaleString()} bytes saved.`
                : ''}{' '}
              Original retained. Images are never downsampled.
            </p>
          )}
          <ol className={styles.ledger}>
            {status.pages.map((page) => (
              <li key={`${status.run?.id}:${page.pageNumber}`}>
                <div className={styles.pageHeading}>
                  <strong>Page {page.pageNumber}</strong>
                  <span>{visualLabels[page.visual.state] ?? page.visual.state}</span>
                </div>
                <p>
                  Embedded text: {page.embeddedText.state.toLowerCase()}.{' '}
                  {'diagnostic' in page.embeddedText && page.embeddedText.diagnostic}
                </p>
                {'diagnostic' in page.visual && <p>{page.visual.diagnostic}</p>}
                {page.recognition && (
                  <p>
                    Recognition request: {page.recognition.status.toLowerCase()} (
                    {page.recognition.mode}).
                  </p>
                )}
                {page.textStreams.map((stream) => (
                  <p className={styles.meta} key={stream.id}>
                    {stream.source.origin === 'EMBEDDED_TEXT'
                      ? 'Embedded text'
                      : 'Recognition transcript'}
                    : {stream.codePointLength.toLocaleString()} code points,{' '}
                    {stream.chunkCount.toLocaleString()} chunks.
                  </p>
                ))}
                {page.textStreams.length > 0 && (
                  <button
                    type="button"
                    aria-expanded={expanded === page.pageNumber}
                    onClick={() =>
                      setExpanded(expanded === page.pageNumber ? null : page.pageNumber)
                    }
                  >
                    Inspect page {page.pageNumber} text
                  </button>
                )}
                {expanded === page.pageNumber && status.run && (
                  <MaterialPageText
                    key={`${status.run.id}:${page.pageNumber}`}
                    materialId={materialId}
                    runId={status.run.id}
                    page={page}
                  />
                )}
              </li>
            ))}
          </ol>
          {status.nextPage !== null && (
            <button type="button" disabled={busy} onClick={() => void morePages()}>
              Read more page states
            </button>
          )}
          {unknown && (
            <p role="alert">
              A provider outcome is unknown or still dispatching. New recognition is blocked.
              Refresh for its retained receipt or ask the owner to inspect processing recovery.
            </p>
          )}
          {isPdf && (
            <div className={styles.recognition}>
              <h4>Recognize visible text and handwriting</h4>
              <p>
                Review the exact configured model before authorizing one request for each supported
                page. Unsupported resolution and illegible writing remain unresolved.
              </p>
              <a href="/admin/providers#material-recognition">
                Owner recognition capability settings
              </a>
              {!options && (
                <button
                  type="button"
                  disabled={busy || !canRecognize || !!recognitionRequest}
                  onClick={() => void reviewRecognition()}
                >
                  Review configured recognition
                </button>
              )}
              {options && (
                <>
                  <p>
                    <strong>
                      {options.provider} / {options.model}
                    </strong>
                  </p>
                  <p>
                    {options.maximumPageRequests === null
                      ? 'Page request count is not yet known.'
                      : `Up to ${options.maximumPageRequests} page requests.`}{' '}
                    Minimum {options.minimumDpi} DPI, {options.maximumImageBytes.toLocaleString()}{' '}
                    decoded image bytes per request. Transport ceiling: 4 MiB. {options.diagnostic}
                  </p>
                  <label className={styles.consent}>
                    <input
                      type="checkbox"
                      checked={consent}
                      disabled={busy || !!recognitionRequest}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    I authorize recognition with this configured model, including any provider
                    charges.
                  </label>
                  <button
                    type="button"
                    disabled={busy || !consent || (!recognitionRequest && !canRecognize)}
                    onClick={() => void recognize()}
                  >
                    {recognitionRequest
                      ? 'Retry saved recognition request'
                      : 'Start reviewed page recognition'}
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
