'use client';

import { useState, useTransition } from 'react';
import styles from './page.module.css';

interface FailedJob {
  id: string;
  name: string;
  failedReason: string;
  timestamp: number;
  attemptsMade: number;
}

export function QueueActions({
  queueName,
  failedCount,
  onRefresh,
}: {
  queueName: string;
  failedCount: number;
  onRefresh?: () => void;
}) {
  const [jobs, setJobs] = useState<FailedJob[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();

  function viewFailed() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/v1/admin/queues/${queueName}/failed`);
      const data = await res.json();
      setJobs(data.jobs);
      setExpanded(true);
    });
  }

  function retryJob(jobId: string) {
    startTransition(async () => {
      await fetch(`/api/v1/admin/queues/${queueName}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      onRefresh?.();
    });
  }

  function cleanAll() {
    if (!confirm(`Clear up to 100 failed jobs from "${queueName}"?`)) return;
    startTransition(async () => {
      await fetch(`/api/v1/admin/queues/${queueName}/clean`, { method: 'POST' });
      setExpanded(false);
      setJobs(null);
      onRefresh?.();
    });
  }

  return (
    <div className={styles.actions}>
      <button
        type="button"
        className={styles.actionButton}
        onClick={viewFailed}
        disabled={isPending}
      >
        {expanded ? 'Hide' : `View Failed (${failedCount})`}
      </button>
      <button
        type="button"
        className={`${styles.actionButton} ${styles.actionButtonDanger}`}
        onClick={cleanAll}
        disabled={isPending}
      >
        Clear All
      </button>

      {expanded && jobs && (
        <div className={styles.failedList}>
          {jobs.map((job) => (
            <div key={job.id} className={styles.failedJob}>
              <div className={styles.failedJobHeader}>
                <span className={styles.failedJobId}>#{job.id}</span>
                <span className={styles.failedJobAttempts}>
                  {job.attemptsMade} attempt{job.attemptsMade !== 1 ? 's' : ''}
                </span>
                <button
                  type="button"
                  className={styles.retryButton}
                  onClick={() => retryJob(job.id!)}
                  disabled={isPending}
                >
                  Retry
                </button>
              </div>
              <p className={styles.failedReason}>{job.failedReason}</p>
              <time className={styles.failedTime}>
                {new Date(job.timestamp).toLocaleString()}
              </time>
            </div>
          ))}
          {jobs.length === 0 && <p className={styles.emptyMessage}>No failed jobs found</p>}
        </div>
      )}
    </div>
  );
}
