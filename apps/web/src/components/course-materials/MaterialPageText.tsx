'use client';

import { useEffect, useRef, useState } from 'react';
import {
  pageTextSchema,
  materialResponse,
  type ProcessingPage,
} from '@/lib/course-materials/client/processing-contracts';
import styles from './MaterialProcessingPanel.module.css';

interface Props {
  materialId: string;
  runId: string;
  page: ProcessingPage;
}

/** Page text stays bounded to the endpoint's current eight-chunk window. */
export function MaterialPageText({ materialId, runId, page }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [window, setWindow] = useState<ReturnType<typeof pageTextSchema.parse> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function load(origin: string, afterIndex = -1) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setSelected(origin);
    setWindow(null);
    setBusy(true);
    setError('');
    try {
      const query = new URLSearchParams({ runId, origin, afterIndex: String(afterIndex) });
      const result = pageTextSchema.parse(
        await materialResponse(
          await fetch(`/api/v1/materials/${materialId}/pages/${page.pageNumber}/text?${query}`, {
            signal: current.signal,
            cache: 'no-store',
          })
        )
      );
      const expected = page.textStreams.find((stream) => stream.source.origin === origin);
      if (
        result.runId !== runId ||
        result.manifest.pageNumber !== page.pageNumber ||
        result.manifest.source.origin !== origin ||
        result.manifest.textSha256 !== expected?.textSha256
      )
        throw new Error('The page text identity changed. Refresh material processing.');
      if (!current.signal.aborted && controller.current === current) setWindow(result);
    } catch (failure) {
      if (!current.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'Could not read page text.');
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className={styles.pageText}>
      <div className={styles.actions}>
        {page.textStreams.map((stream) => (
          <button
            key={stream.id}
            type="button"
            aria-pressed={selected === stream.source.origin}
            onClick={() => void load(stream.source.origin)}
          >
            {stream.source.origin === 'EMBEDDED_TEXT'
              ? 'Read embedded text'
              : 'Read recognition transcript'}
          </button>
        ))}
      </div>
      {busy && <p role="status">Reading page text</p>}
      {error && <p role="alert">{error}</p>}
      {window && !busy && (
        <>
          <p className={styles.meta}>
            {window.manifest.codePointLength.toLocaleString()} code points in this stream.
            {window.chunks.length
              ? ` Showing ${window.chunks[0].codePointStart.toLocaleString()} to ${window.chunks.at(-1)!.codePointEnd.toLocaleString()}.`
              : ' The stored stream contains no text. This does not establish that the page is blank.'}
          </p>
          <pre className={styles.transcript}>
            {window.chunks.map((chunk) => chunk.text).join('')}
          </pre>
          <div className={styles.actions}>
            {(window.chunks[0]?.index ?? 0) > 0 && (
              <button type="button" onClick={() => void load(selected!)}>
                Back to start
              </button>
            )}
            {window.nextIndex !== null && (
              <button type="button" onClick={() => void load(selected!, window.nextIndex!)}>
                Read next text chunks
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
