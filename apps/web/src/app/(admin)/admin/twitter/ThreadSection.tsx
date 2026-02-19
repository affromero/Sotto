'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { GenerationProgress } from '@/components/create/GenerationProgress';
import styles from './ThreadSection.module.css';

interface ThreadPodcast {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  source: string;
  failureReason?: string | null;
}

function getWorkerStepLabel(state: string | null, progress: number): string {
  if (state === 'waiting' || state === 'delayed') return 'Queued...';
  if (progress < 10) return 'Starting...';
  if (progress < 20) return 'Fetching tweet';
  if (progress < 40) return 'Fetching tweet data';
  if (progress < 60) return 'Fetching full thread';
  if (progress < 80) return 'Parsing intent';
  if (progress < 100) return 'Creating podcast';
  return 'Starting pipeline';
}

export function ThreadSection() {
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [podcasts, setPodcasts] = useState<ThreadPodcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobState, setJobState] = useState<string | null>(null);
  const [activePodcastId, setActivePodcastId] = useState<string | null>(null);
  const [podcastStatus, setPodcastStatus] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [workerCount, setWorkerCount] = useState<number | null>(null);
  const [submittedUrl, setSubmittedUrl] = useState<string | null>(null);
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const pollRef = useRef(false);

  const loadRecentThreadPodcasts = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/twitter/analytics');
      if (!res.ok) return;
      const data = await res.json();
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

  // Worker phase polling: fetching tweet → parsing intent → creating podcast
  useEffect(() => {
    if (!activeJobId || activePodcastId) return;

    pollRef.current = true;

    const interval = setInterval(async () => {
      if (!pollRef.current) return;
      try {
        const res = await fetch(`/api/admin/twitter/job-status/${activeJobId}`);
        if (!res.ok) return;
        const data = await res.json();
        setJobProgress(typeof data.progress === 'number' ? data.progress : 0);
        setJobState(data.state);
        if (typeof data.workerCount === 'number') setWorkerCount(data.workerCount);
        if (data.podcastId) {
          clearInterval(interval);
          pollRef.current = false;
          setActivePodcastId(data.podcastId);
          setPodcastStatus('EXTRACTING');
        } else if (data.state === 'failed') {
          clearInterval(interval);
          pollRef.current = false;
          setJobError(data.failedReason ?? 'Worker failed');
        }
      } catch {
        // Transient error — keep polling
      }
    }, 2000);

    return () => {
      clearInterval(interval);
      pollRef.current = false;
    };
  }, [activeJobId, activePodcastId]);

  // Pipeline phase polling: EXTRACTING → ... → READY
  useEffect(() => {
    if (!activePodcastId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/podcasts/${activePodcastId}`);
        if (!res.ok) return;
        const data = await res.json();
        setPodcastStatus(data.status);
        if (data.status === 'READY') {
          clearInterval(interval);
          loadRecentThreadPodcasts();
        } else if (data.status === 'FAILED') {
          clearInterval(interval);
          setJobError('Podcast generation failed');
        }
      } catch {
        // Transient error — keep polling
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [activePodcastId, loadRecentThreadPodcasts]);

  const handleSubmit = async () => {
    if (!url.trim()) return;

    const tweetUrlPattern = /^https?:\/\/(x\.com|twitter\.com)\/.+\/status\/\d+/;
    if (!tweetUrlPattern.test(url.trim())) {
      setError('Invalid tweet URL. Expected format: https://x.com/user/status/123...');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/twitter/thread-to-podcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tweetUrl: url.trim(),
          ...(message.trim() && { message: message.trim() }),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to submit');
      }

      const data = await res.json();
      setSubmittedUrl(url.trim());
      setSubmittedMessage(message.trim() || null);
      setUrl('');
      setMessage('');
      setActiveJobId(data.jobId);
      setJobProgress(0);
      setJobState('active');
      setActivePodcastId(null);
      setPodcastStatus(null);
      setJobError(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = async (podcastId: string) => {
    setRetryingIds((prev) => new Set(prev).add(podcastId));
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/generate`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Retry failed');
        return;
      }
      await loadRecentThreadPodcasts();
    } catch {
      setError('Retry failed');
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(podcastId);
        return next;
      });
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
            disabled={submitting || !url.trim() || !!activeJobId}
          >
            {submitting ? 'Submitting...' : 'Generate Podcast'}
          </button>
        </div>

        <div>
          <label className={styles.label} htmlFor="adminMessage">
            Your message (as if tagging @sotto)
          </label>
          <span className={styles.hint}>
            Optional — controls duration, depth, audience. Leave blank to infer from the tweet.
          </span>
        </div>
        <textarea
          id="adminMessage"
          className={styles.messageTextarea}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="@sotto make a 5min eli5 about this for nerds"
          rows={3}
          maxLength={1000}
        />

        {error && !activeJobId && <div className={styles.error}>{error}</div>}

        {/* Submitted context — visible during processing */}
        {activeJobId && submittedUrl && (
          <div className={styles.submittedContext}>
            <span className={styles.submittedUrl}>{submittedUrl}</span>
            {submittedMessage && (
              <span className={styles.submittedMessage}>{submittedMessage}</span>
            )}
          </div>
        )}

        {/* Worker phase: fetching tweet / parsing intent */}
        {activeJobId && !activePodcastId && !jobError && (
          <div className={styles.progressSection}>
            <div className={styles.progressHeader}>
              <span className={styles.progressTitle}>Processing Thread</span>
              <span className={styles.progressPercent}>{jobProgress}%</span>
            </div>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${jobProgress}%` }} />
            </div>
            <span className={styles.progressLabel}>{getWorkerStepLabel(jobState, jobProgress)}</span>
            {workerCount === 0 && (
              <span className={styles.workerWarning}>
                No workers connected — the workers container needs to be rebuilt and restarted.
              </span>
            )}
          </div>
        )}

        {/* Pipeline phase: GenerationProgress */}
        {activePodcastId && podcastStatus && podcastStatus !== 'READY' && !jobError && (
          <div className={styles.progressSection}>
            <GenerationProgress status={podcastStatus} />
          </div>
        )}

        {/* Done */}
        {activePodcastId && podcastStatus === 'READY' && (
          <div className={styles.successBanner}>
            <span>Podcast ready!</span>
            <a href={`/podcast/${activePodcastId}`} className={styles.link}>
              View Podcast
            </a>
            <button
              type="button"
              className={styles.dismissButton}
              onClick={() => {
                setActiveJobId(null);
                setActivePodcastId(null);
                setPodcastStatus(null);
                setSubmittedUrl(null);
                setSubmittedMessage(null);
              }}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {/* Error */}
        {jobError && (
          <div className={styles.errorWithDismiss}>
            {jobError}
            <button
              type="button"
              className={styles.dismissButton}
              onClick={() => {
                setActiveJobId(null);
                setJobError(null);
                setActivePodcastId(null);
                setSubmittedUrl(null);
                setSubmittedMessage(null);
              }}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}
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
                    <span
                      className={`${styles.badge} ${styles[`badge${p.status}`] || ''}`}
                      title={p.status === 'FAILED' && p.failureReason ? p.failureReason : undefined}
                    >
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
                    {p.status === 'FAILED' && (
                      <button
                        type="button"
                        className={styles.retryButton}
                        onClick={() => handleRetry(p.id)}
                        disabled={retryingIds.has(p.id)}
                      >
                        {retryingIds.has(p.id) ? 'Retrying...' : 'Retry'}
                      </button>
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
