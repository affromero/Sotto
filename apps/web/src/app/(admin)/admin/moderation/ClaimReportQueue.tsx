'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './ClaimReportQueue.module.css';

interface ClaimReportItem {
  id: string;
  podcastId: string;
  turnIndex: number;
  turnText: string;
  description: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  reporter: {
    id: string;
    name: string | null;
    email: string | null;
    handle: string | null;
  };
  podcast: {
    id: string;
    title: string;
  };
}

interface ClaimReportStats {
  pending: number;
  reviewing: number;
  verified: number;
  inaccurate: number;
  dismissed: number;
  total: number;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ClaimReportQueue() {
  const [reports, setReports] = useState<ClaimReportItem[]>([]);
  const [stats, setStats] = useState<ClaimReportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [acting, setActing] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (statusFilter) params.set('status', statusFilter);

    const response = await fetch(`/api/admin/claim-reports?${params}`);
    if (response.ok) {
      const data = await response.json();
      setReports(data.items);
      setTotalPages(data.totalPages);
    }
    setLoading(false);
  }, [page, statusFilter]);

  const fetchStats = useCallback(async () => {
    const response = await fetch('/api/admin/claim-reports/stats');
    if (response.ok) {
      setStats(await response.json());
    }
  }, []);

  useEffect(() => {
    fetchReports(); // eslint-disable-line react-hooks/set-state-in-effect -- async data fetch
  }, [fetchReports]);

  useEffect(() => {
    fetchStats(); // eslint-disable-line react-hooks/set-state-in-effect -- async data fetch
  }, [fetchStats]);

  const resolveReport = useCallback(
    async (reportId: string, status: string, resolution?: string) => {
      setActing(reportId);
      const response = await fetch(`/api/admin/claim-reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, resolution }),
      });
      if (response.ok) {
        await Promise.all([fetchReports(), fetchStats()]);
      }
      setActing(null);
    },
    [fetchReports, fetchStats]
  );

  return (
    <div className={styles.root}>
      {stats && (
        <div className={styles.statsBar}>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{stats.pending}</span>
            <span className={styles.statLabel}>Pending</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{stats.reviewing}</span>
            <span className={styles.statLabel}>Reviewing</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{stats.verified}</span>
            <span className={styles.statLabel}>Verified</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{stats.inaccurate}</span>
            <span className={styles.statLabel}>Inaccurate</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{stats.dismissed}</span>
            <span className={styles.statLabel}>Dismissed</span>
          </div>
        </div>
      )}

      <div className={styles.filters}>
        <select
          className={styles.filterSelect}
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="REVIEWING">Reviewing</option>
          <option value="RESOLVED_VERIFIED">Verified</option>
          <option value="RESOLVED_INACCURATE">Inaccurate</option>
          <option value="DISMISSED">Dismissed</option>
        </select>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading claim reports...</div>
      ) : reports.length === 0 ? (
        <div className={styles.empty}>No claim reports found</div>
      ) : (
        <div className={styles.reportList}>
          {reports.map((report) => {
            const isActing = acting === report.id;
            const reporterName =
              report.reporter.handle || report.reporter.name || report.reporter.email || 'Unknown';
            const snippet =
              report.turnText.length > 200
                ? report.turnText.slice(0, 200) + '...'
                : report.turnText;

            return (
              <div key={report.id} className={styles.reportCard}>
                <div className={styles.reportTop}>
                  <div className={styles.reportMeta}>
                    <div className={styles.reportMetaRow}>
                      <span
                        className={`${styles.badge} ${styles[`badge${report.status}`] || ''}`}
                      >
                        {report.status.replace(/_/g, ' ')}
                      </span>
                      <span className={styles.podcastTitle}>
                        {report.podcast.title}
                      </span>
                      <span className={styles.turnLabel}>
                        Turn #{report.turnIndex + 1}
                      </span>
                    </div>
                    <div className={styles.reportMetaRow}>
                      <span className={styles.reporterName}>
                        Reported by {reporterName}
                      </span>
                      <span className={styles.reportTime}>
                        {formatDate(report.createdAt)}
                      </span>
                    </div>
                    <blockquote className={styles.turnSnippet}>
                      {snippet}
                    </blockquote>
                    <p className={styles.reportDescription}>
                      {report.description}
                    </p>
                    {report.resolution && (
                      <p className={styles.reportDescription}>
                        Resolution: {report.resolution}
                      </p>
                    )}
                  </div>

                  {(report.status === 'PENDING' ||
                    report.status === 'REVIEWING') && (
                    <div className={styles.actions}>
                      <button
                        className={`${styles.actionBtn} ${styles.actionBtnSuccess}`}
                        onClick={() =>
                          resolveReport(report.id, 'RESOLVED_VERIFIED', 'Claim verified as accurate')
                        }
                        disabled={isActing}
                        type="button"
                      >
                        Verified
                      </button>
                      <button
                        className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                        onClick={() =>
                          resolveReport(report.id, 'RESOLVED_INACCURATE', 'Claim found to be inaccurate')
                        }
                        disabled={isActing}
                        type="button"
                      >
                        Inaccurate
                      </button>
                      <button
                        className={styles.actionBtn}
                        onClick={() =>
                          resolveReport(report.id, 'DISMISSED', 'Dismissed')
                        }
                        disabled={isActing}
                        type="button"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

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
