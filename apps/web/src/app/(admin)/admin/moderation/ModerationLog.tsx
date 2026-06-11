'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './ModerationLog.module.css';

interface ModerationActionItem {
  id: string;
  action: string;
  reason: string;
  createdAt: string;
  metadata: Record<string, unknown> | null;
  user: {
    id: string;
    name: string | null;
    email: string | null;
  };
  moderator: {
    id: string;
    name: string | null;
    email: string | null;
  };
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ModerationLog() {
  const [actions, setActions] = useState<ModerationActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const response = await fetch(
        `/api/v1/admin/moderation-log?page=${page}&limit=30`
      );
      if (cancelled) return;
      if (response.ok) {
        const data = await response.json();
        setActions(data.items);
        setTotalPages(data.totalPages);
      }
      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
     
  }, [page]);

  if (loading) {
    return <div className={styles.loading}>Loading moderation log...</div>;
  }

  if (actions.length === 0) {
    return <div className={styles.empty}>No moderation actions recorded</div>;
  }

  return (
    <div className={styles.root}>
      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Action</th>
              <th>Target User</th>
              <th>Moderator</th>
              <th>Reason</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((entry) => {
              const targetName =
                entry.user.name || entry.user.email || 'Unknown';
              const modName =
                entry.moderator.name || entry.moderator.email || 'Unknown';

              return (
                <tr key={entry.id}>
                  <td>
                    <span
                      className={`${styles.actionBadge} ${styles[`action${entry.action.charAt(0).toUpperCase()}${entry.action.slice(1)}`] || ''}`}
                    >
                      {entry.action.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td>
                    <Link
                      href={`/admin/users`}
                      className={styles.userLink}
                    >
                      {targetName}
                    </Link>
                  </td>
                  <td className={styles.secondaryCell}>{modName}</td>
                  <td className={styles.reasonCell} title={entry.reason}>
                    {entry.reason}
                  </td>
                  <td className={styles.dateCell}>
                    {formatDate(entry.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button
            className={styles.pageBtn}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            type="button"
          >
            Previous
          </button>
          <span className={styles.pageInfo}>
            Page {page} of {totalPages}
          </span>
          <button
            className={styles.pageBtn}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            type="button"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
