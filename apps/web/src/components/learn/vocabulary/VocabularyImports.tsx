'use client';

import { useState } from 'react';
import styles from './VocabularyImports.module.css';

export interface VocabularyImport {
  id: string;
  name: string;
  status: string;
  error: string | null;
  processedChunks: number;
  totalChunks: number;
  entries: number;
}
const LABELS: Record<string, string> = {
  NOT_INDEXED: 'Ready to index',
  PENDING: 'Queued',
  ACTIVE: 'Indexing vocabulary',
  COMPLETE: 'Coverage verified',
  FAILED: 'Partially indexed',
  NEEDS_TEXT: 'Text needed',
  UNRESOLVED: 'Recovery needed',
};
export function VocabularyImports({
  materials,
  onChanged,
}: {
  materials: VocabularyImport[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!materials.length) return null;
  async function start(material: VocabularyImport) {
    setBusy(material.id);
    setError('');
    try {
      const response = await fetch(`/api/v1/materials/${material.id}/vocabulary-index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retry: ['FAILED', 'UNRESOLVED'].includes(material.status) }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Indexing could not start.');
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Indexing could not start.');
    } finally {
      setBusy('');
    }
  }
  return (
    <section className={styles.root} aria-label="Material vocabulary imports">
      <div className={styles.heading}>
        <h2>Words from your materials</h2>
        <span>One dictionary, every source.</span>
      </div>
      <p>
        Each source section is indexed and checked for missing entries. Importing a word adds it to
        your dictionary without assuming you know it.
      </p>
      <ul>
        {materials.map((material) => (
          <li key={material.id}>
            <div className={styles.name}>
              <a href={`/api/v1/materials/${material.id}/file`}>{material.name}</a>
              <span>{LABELS[material.status] ?? material.status}</span>
            </div>
            {material.totalChunks > 0 && (
              <div className={styles.progress}>
                <progress
                  max={material.totalChunks}
                  value={material.processedChunks}
                  aria-label={`${material.name} verified sections`}
                />
                <small>
                  {material.processedChunks} / {material.totalChunks} sections · {material.entries}{' '}
                  source entries
                </small>
              </div>
            )}
            {material.error && <p className={styles.failure}>{material.error}</p>}
            {['NOT_INDEXED', 'FAILED', 'UNRESOLVED'].includes(material.status) && (
              <button disabled={busy === material.id} onClick={() => void start(material)}>
                {busy === material.id
                  ? 'Queueing…'
                  : material.status === 'NOT_INDEXED'
                    ? 'Index all vocabulary'
                    : 'Retry unfinished sections'}
              </button>
            )}
          </li>
        ))}
      </ul>
      <small>
        Indexing uses your configured AI once per reviewed section. Completed sections are reused on
        retry. Pronunciation is prepared locally and stored for replay.
      </small>
      {error && (
        <p role="alert" className={styles.failure}>
          {error}
        </p>
      )}
    </section>
  );
}
