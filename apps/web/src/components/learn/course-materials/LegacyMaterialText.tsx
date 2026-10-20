'use client';

import { useEffect, useRef, useState } from 'react';
import { legacyMaterialTextSchema } from '@sotto/shared';
import styles from './LegacyMaterialText.module.css';

interface Props {
  materialId: string;
  url: string;
}
type TextWindow = ReturnType<typeof legacyMaterialTextSchema.parse>;

export function LegacyMaterialText(props: Props) {
  return <LegacyTextWindow key={`${props.materialId}:${props.url}`} {...props} />;
}

function LegacyTextWindow({ materialId, url }: Props) {
  const [window, setWindow] = useState<TextWindow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function read(offset = 0) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError('');
    try {
      if (url !== `/api/v1/materials/${encodeURIComponent(materialId)}/legacy-text`)
        throw new Error('The retained text link does not match this material. Refresh the course.');
      const query = new URLSearchParams({ offset: String(offset), limit: '8192' });
      const response = await fetch(`${url}?${query}`, {
        credentials: 'include',
        cache: 'no-store',
        signal: current.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error('Could not read previously imported text.');
      const result = legacyMaterialTextSchema.parse(body);
      const end = offset + [...result.text].length;
      if (
        result.materialId !== materialId ||
        result.offset !== offset ||
        (offset > 0 && result.totalCodePoints !== window?.totalCodePoints) ||
        end > result.totalCodePoints ||
        (end < result.totalCodePoints && (end === offset || result.nextOffset !== end)) ||
        (end === result.totalCodePoints && result.nextOffset !== null)
      )
        throw new Error('The imported text changed. Reopen this material before continuing.');
      if (!current.signal.aborted && controller.current === current) setWindow(result);
    } catch (cause) {
      if (!current.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : 'Could not read previously imported text.'
        );
    } finally {
      if (!current.signal.aborted && controller.current === current) setBusy(false);
    }
  }

  return (
    <section className={styles.root} aria-label="Previously imported text">
      <p>
        Previously imported text. Page-by-page extraction coverage is unavailable for this older
        extract.
      </p>
      <div className={styles.actions}>
        {(!window || window.offset > 0) && (
          <button type="button" disabled={busy} onClick={() => void read()}>
            Read imported text from start
          </button>
        )}
        {window?.nextOffset !== null && window && (
          <button type="button" disabled={busy} onClick={() => void read(window.nextOffset!)}>
            Read next text section
          </button>
        )}
      </div>
      {busy && <p role="status">Reading imported text...</p>}
      {error && <p role="alert">{error}</p>}
      {window && !busy && (
        <>
          <p>
            Showing characters {(window.text ? window.offset + 1 : window.offset).toLocaleString()}{' '}
            to {(window.offset + [...window.text].length).toLocaleString()} of{' '}
            {window.totalCodePoints.toLocaleString()}.
          </p>
          <pre className={styles.text}>{window.text || 'This older extract contains no text.'}</pre>
        </>
      )}
    </section>
  );
}
