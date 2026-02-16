'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './ThreadSection.module.css';

interface ThreadPodcast {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  source: string;
}

export function ThreadSection() {
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [podcasts, setPodcasts] = useState<ThreadPodcast[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRecentThreadPodcasts = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/twitter/analytics');
      if (!res.ok) return;
      const data = await res.json();
      // Filter from recent twitter-sourced podcasts (source=TWITTER gives us both mentions and threads)
      // We show all twitter-sourced podcasts as a simple reference list
      if (data.recentThreadPodcasts) {
        setPodcasts(data.recentThreadPodcasts);
      }
    } catch {
      // Non-critical — silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecentThreadPodcasts();
  }, [loadRecentThreadPodcasts]);

  const handleSubmit = async () => {
    if (!url.trim()) return;

    const tweetUrlPattern = /^https?:\/\/(x\.com|twitter\.com)\/.+\/status\/\d+/;
    if (!tweetUrlPattern.test(url.trim())) {
      setError('Invalid tweet URL. Expected format: https://x.com/user/status/123...');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/admin/twitter/thread-to-podcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tweetUrl: url.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to submit');
      }

      const data = await res.json();
      setSuccess(`Job queued (ID: ${data.jobId}). Podcast will appear below once processing completes.`);
      setUrl('');
      // Refresh the list after a short delay
      setTimeout(loadRecentThreadPodcasts, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.section}>
      <div className={styles.form}>
        <div>
          <label className={styles.label} htmlFor="tweetUrl">
            Tweet / Thread URL
          </label>
          <span className={styles.hint}>
            Paste a tweet or thread URL to generate a podcast as @sotto
          </span>
        </div>

        <div className={styles.inputRow}>
          <input
            id="tweetUrl"
            type="url"
            className={styles.urlInput}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://x.com/user/status/123456789..."
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
          <button
            type="button"
            className={styles.generateButton}
            onClick={handleSubmit}
            disabled={submitting || !url.trim()}
          >
            {submitting ? 'Submitting...' : 'Generate Podcast'}
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}
        {success && <div className={styles.success}>{success}</div>}
      </div>

      <div className={styles.tableWrapper}>
        <h3 className={styles.subTitle}>Recent Thread Podcasts</h3>
        {loading ? (
          <div className={styles.loading}>Loading...</div>
        ) : podcasts.length === 0 ? (
          <div className={styles.hint}>No thread podcasts yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Date</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {podcasts.map((p) => (
                <tr key={p.id}>
                  <td className={styles.truncate}>{p.title}</td>
                  <td>
                    <span className={`${styles.badge} ${styles[`badge${p.status}`] || ''}`}>
                      {p.status}
                    </span>
                  </td>
                  <td>{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td>
                    {p.status === 'READY' && (
                      <a href={`/podcast/${p.id}`} className={styles.link}>
                        View
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
