'use client';

import { useState } from 'react';
import { AlertTriangle, Plus, X } from 'lucide-react';
import styles from './InsufficientRefsBanner.module.css';

interface InsufficientRefsBannerProps {
  refCount: number;
  requiredCount: number;
  podcastId: string;
  onRegenerate: () => void;
}

const MAX_URLS = 5;

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function InsufficientRefsBanner({
  refCount,
  requiredCount,
  podcastId,
  onRegenerate,
}: InsufficientRefsBannerProps) {
  const [urls, setUrls] = useState<string[]>(['']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validUrls = urls.filter(isValidUrl);

  function addField() {
    if (urls.length < MAX_URLS) {
      setUrls([...urls, '']);
    }
  }

  function removeField(index: number) {
    setUrls(urls.filter((_, i) => i !== index));
  }

  function updateField(index: number, value: string) {
    const next = [...urls];
    next[index] = value;
    setUrls(next);
  }

  async function handleRegenerate() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/script/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback: 'User provided source URLs to improve references.',
          ...(validUrls.length > 0 ? { sourceUrls: validUrls } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to regenerate');
      }
      onRegenerate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate');
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.banner} role="alert">
      <div className={styles.header}>
        <AlertTriangle size={18} className={styles.icon} aria-hidden="true" />
        <h3 className={styles.title}>This podcast needs more references</h3>
      </div>

      <p className={styles.body}>
        We found {refCount} of {requiredCount} required sources. You can help by
        providing links to relevant articles, news reports, or papers.
      </p>

      <div className={styles.urlFields}>
        {urls.map((url, i) => (
          <div key={i} className={styles.urlRow}>
            <input
              type="url"
              className={styles.urlInput}
              placeholder="https://example.com/article"
              value={url}
              onChange={(e) => updateField(i, e.target.value)}
              aria-label={`Source URL ${i + 1}`}
            />
            {urls.length > 1 && (
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => removeField(i)}
                aria-label="Remove URL"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}

        {urls.length < MAX_URLS && (
          <button type="button" className={styles.addBtn} onClick={addField}>
            <Plus size={14} />
            Add another URL
          </button>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <button
        type="button"
        className={styles.regenerateBtn}
        onClick={handleRegenerate}
        disabled={submitting}
      >
        {submitting ? 'Regenerating...' : 'Regenerate with these sources'}
      </button>
    </div>
  );
}
