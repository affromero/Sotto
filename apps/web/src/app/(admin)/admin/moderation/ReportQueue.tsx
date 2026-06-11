'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './ReportQueue.module.css';

interface ReportPodcast {
  id: string;
  title: string;
  source: string;
  isHumanContent: boolean;
  status: string;
}

interface ReportItem {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  description: string | null;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  claimantEmail: string | null;
  claimantName: string | null;
  evidenceUrl: string | null;
  segmentVisualId: string | null;
  counterNotice: string | null;
  reporter: {
    id: string;
    name: string | null;
    email: string | null;
    handle: string | null;
  };
  podcast: ReportPodcast | null;
  segmentVisual: { id: string; assetUrl: string | null; visualType: string; status: string } | null;
}

interface ReportStats {
  pending: number;
  reviewing: number;
  actioned: number;
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

function formatReason(reason: string): string {
  return reason.replace(/_/g, ' ');
}

export function ReportQueue() {
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [targetTypeFilter, setTargetTypeFilter] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const [acting, setActing] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (statusFilter) params.set('status', statusFilter);
    if (targetTypeFilter) params.set('targetType', targetTypeFilter);
    if (reasonFilter) params.set('reason', reasonFilter);

    const response = await fetch(`/api/admin/reports?${params}`);
    if (response.ok) {
      const data = await response.json();
      setReports(data.items);
      setTotalPages(data.totalPages);
    }
    setLoading(false);
  }, [page, statusFilter, targetTypeFilter, reasonFilter]);

  const fetchStats = useCallback(async () => {
    const response = await fetch('/api/admin/reports/stats');
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
    async (reportId: string, status: string, resolution: string) => {
      setActing(reportId);
      const response = await fetch(`/api/admin/reports/${reportId}`, {
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

  const moderateUser = useCallback(
    async (
      reportId: string,
      userId: string,
      action: string,
      reason: string,
      durationDays?: number
    ) => {
      setActing(reportId);
      const body: Record<string, unknown> = { action, reason };
      if (durationDays) body.durationDays = durationDays;

      const modResponse = await fetch(`/api/admin/users/${userId}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (modResponse.ok) {
        await resolveReport(reportId, 'RESOLVED_ACTIONED', `${action}: ${reason}`);
      }
      setActing(null);
    },
    [resolveReport]
  );

  const removeBadge = useCallback(
    async (reportId: string, podcastId: string) => {
      setActing(reportId);
      const response = await fetch(`/api/admin/podcasts/${podcastId}/badge`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isHumanContent: false,
          reason: 'Removed via report review — false human content claim',
        }),
      });

      if (response.ok) {
        await resolveReport(reportId, 'RESOLVED_ACTIONED', 'Human badge removed');
      }
      setActing(null);
    },
    [resolveReport]
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
            <span className={styles.statValue}>{stats.actioned}</span>
            <span className={styles.statLabel}>Actioned</span>
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
          <option value="RESOLVED_ACTIONED">Actioned</option>
          <option value="RESOLVED_DISMISSED">Dismissed</option>
          <option value="ASSET_REPLACED">Asset Replaced</option>
          <option value="DELISTED">Delisted</option>
        </select>

        <select
          className={styles.filterSelect}
          value={targetTypeFilter}
          onChange={(e) => {
            setTargetTypeFilter(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by target type"
        >
          <option value="">All types</option>
          <option value="podcast">Podcast</option>
          <option value="user">User</option>
        </select>

        <select
          className={styles.filterSelect}
          value={reasonFilter}
          onChange={(e) => {
            setReasonFilter(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by reason"
        >
          <option value="">All reasons</option>
          <option value="HARASSMENT">Harassment</option>
          <option value="HATE_SPEECH">Hate Speech</option>
          <option value="VIOLENCE">Violence</option>
          <option value="SEXUAL_CONTENT">Sexual Content</option>
          <option value="MISINFORMATION">Misinformation</option>
          <option value="SPAM">Spam</option>
          <option value="IMPERSONATION">Impersonation</option>
          <option value="COPYRIGHT">Copyright</option>
          <option value="VOICE_THEFT">Voice Theft</option>
          <option value="FALSE_HUMAN_BADGE">False Human Badge</option>
          <option value="FALSE_CLAIM">False Claim</option>
          <option value="OTHER">Other</option>
        </select>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading reports...</div>
      ) : reports.length === 0 ? (
        <div className={styles.empty}>No reports found</div>
      ) : (
        <div className={styles.reportList}>
          {reports.map((report) => {
            const isActing = acting === report.id;
            const reporterName =
              report.reporter.name || report.reporter.email || 'Unknown';

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
                      <span className={`${styles.badge} ${styles.reasonBadge}`}>
                        {formatReason(report.reason)}
                      </span>
                      <span className={`${styles.badge} ${styles.typeBadge}`}>
                        {report.targetType}
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
                    {report.description && (
                      <p className={styles.reportDescription}>
                        {report.description}
                      </p>
                    )}
                    {report.resolution && (
                      <p className={styles.reportDescription}>
                        Resolution: {report.resolution}
                      </p>
                    )}
                    {report.reason === 'COPYRIGHT' && (
                      <div className={styles.copyrightDetails}>
                        {report.claimantName && (
                          <p className={styles.reportDescription}>
                            Claimant: {report.claimantName}
                            {report.claimantEmail && ` (${report.claimantEmail})`}
                          </p>
                        )}
                        {report.evidenceUrl && (
                          <p className={styles.reportDescription}>
                            Evidence:{' '}
                            <a href={report.evidenceUrl} target="_blank" rel="noopener noreferrer">
                              {report.evidenceUrl}
                            </a>
                          </p>
                        )}
                        {report.segmentVisual && (
                          <p className={styles.reportDescription}>
                            Visual: {report.segmentVisual.visualType} ({report.segmentVisual.status})
                          </p>
                        )}
                        {report.counterNotice && (
                          <p className={styles.reportDescription}>
                            Counter-notice: {report.counterNotice}
                          </p>
                        )}
                      </div>
                    )}
                    {report.podcast && (
                      <p className={styles.targetPreview}>
                        Podcast: {report.podcast.title}
                        {report.podcast.isHumanContent && ' [Human Badge]'}
                        {' — '}
                        {report.podcast.source}
                      </p>
                    )}
                  </div>

                  {(report.status === 'PENDING' ||
                    report.status === 'REVIEWING') && (
                    <div className={styles.actions}>
                      <button
                        className={styles.actionBtn}
                        onClick={() =>
                          resolveReport(
                            report.id,
                            'RESOLVED_DISMISSED',
                            'Dismissed — no action needed'
                          )
                        }
                        disabled={isActing}
                        type="button"
                      >
                        Dismiss
                      </button>
                      {report.targetType === 'user' && (
                        <>
                          <button
                            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                            onClick={() =>
                              moderateUser(
                                report.id,
                                report.targetId,
                                'warn',
                                `Warning issued from report: ${formatReason(report.reason)}`
                              )
                            }
                            disabled={isActing}
                            type="button"
                          >
                            Warn
                          </button>
                          <button
                            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                            onClick={() =>
                              moderateUser(
                                report.id,
                                report.targetId,
                                'suspend',
                                `Suspended from report: ${formatReason(report.reason)}`,
                                7
                              )
                            }
                            disabled={isActing}
                            type="button"
                          >
                            Suspend 7d
                          </button>
                          <button
                            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                            onClick={() =>
                              moderateUser(
                                report.id,
                                report.targetId,
                                'ban',
                                `Banned from report: ${formatReason(report.reason)}`
                              )
                            }
                            disabled={isActing}
                            type="button"
                          >
                            Ban
                          </button>
                        </>
                      )}
                      {report.targetType === 'podcast' && (
                        <button
                          className={`${styles.actionBtn} ${styles.actionBtnSuccess}`}
                          onClick={() =>
                            resolveReport(
                              report.id,
                              'RESOLVED_ACTIONED',
                              'Content reviewed and actioned'
                            )
                          }
                          disabled={isActing}
                          type="button"
                        >
                          Action
                        </button>
                      )}
                      {report.podcast?.isHumanContent && (
                        <button
                          className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                          onClick={() => removeBadge(report.id, report.targetId)}
                          disabled={isActing}
                          type="button"
                        >
                          Remove Human Badge
                        </button>
                      )}
                      {report.reason === 'COPYRIGHT' && report.segmentVisualId && (
                        <button
                          className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                          onClick={() =>
                            resolveReport(
                              report.id,
                              'ASSET_REPLACED',
                              'Copyrighted visual replaced with AI illustration'
                            )
                          }
                          disabled={isActing}
                          type="button"
                        >
                          Replace Asset
                        </button>
                      )}
                      {report.reason === 'COPYRIGHT' && report.targetType === 'podcast' && (
                        <button
                          className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                          onClick={() =>
                            resolveReport(
                              report.id,
                              'DELISTED',
                              'Podcast delisted due to copyright claim'
                            )
                          }
                          disabled={isActing}
                          type="button"
                        >
                          Delist Podcast
                        </button>
                      )}
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
