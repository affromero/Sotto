'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import styles from './DuplicateReview.module.css';

interface PodcastUser {
  id: string;
  name: string | null;
  handle: string | null;
  image: string | null;
}

interface MatchPodcast {
  id: string;
  title: string;
  duration: number | null;
  audioUrl: string | null;
  sourcePlatform: string | null;
  isHumanContent: boolean;
  createdAt: string;
  user: PodcastUser;
}

interface DuplicateMatchItem {
  id: string;
  sourcePodcastId: string;
  matchedPodcastId: string;
  similarity: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  resolution: string | null;
  reviewedAt: string | null;
  createdAt: string;
  sourcePodcast: MatchPodcast;
  matchedPodcast: MatchPodcast;
}

type FilterStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';

interface DuplicateReviewProps {
  initialPendingCount: number;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getSimilarityColor(similarity: number): string {
  if (similarity >= 0.95) return 'var(--color-error)';
  if (similarity >= 0.90) return 'var(--color-primary)';
  return 'var(--color-warning)';
}

export function DuplicateReview({ initialPendingCount }: DuplicateReviewProps) {
  const [matches, setMatches] = useState<DuplicateMatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('PENDING');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [acting, setActing] = useState<string | null>(null);
  const [resolutionText, setResolutionText] = useState<Record<string, string>>({});
  const [confirmAction, setConfirmAction] = useState<{ matchId: string; action: 'approve' | 'reject' } | null>(null);

  const [counts, setCounts] = useState({
    pending: initialPendingCount,
    approved: 0,
    rejected: 0,
  });

  const fetchMatches = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      status: statusFilter,
      page: String(page),
      limit: '20',
    });

    const response = await fetch(`/api/admin/duplicates?${params}`);
    if (response.ok) {
      const data = await response.json();
      setMatches(data.items);
      setTotalPages(data.totalPages);
      setTotal(data.total);
    }
    setLoading(false);
  }, [statusFilter, page]);

  const fetchCounts = useCallback(async () => {
    const [pending, approved, rejected] = await Promise.all([
      fetch('/api/admin/duplicates?status=PENDING&limit=1').then((r) => r.json()),
      fetch('/api/admin/duplicates?status=APPROVED&limit=1').then((r) => r.json()),
      fetch('/api/admin/duplicates?status=REJECTED&limit=1').then((r) => r.json()),
    ]);
    setCounts({
      pending: pending.total ?? 0,
      approved: approved.total ?? 0,
      rejected: rejected.total ?? 0,
    });
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchMatches(); }, [fetchMatches]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  const resolveMatch = useCallback(
    async (matchId: string, action: 'approve' | 'reject') => {
      setActing(matchId);
      setConfirmAction(null);

      const response = await fetch(`/api/admin/duplicates/${matchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          resolution: resolutionText[matchId] || undefined,
        }),
      });

      if (response.ok) {
        setResolutionText((prev) => {
          const next = { ...prev };
          delete next[matchId];
          return next;
        });
        await Promise.all([fetchMatches(), fetchCounts()]);
      }
      setActing(null);
    },
    [resolutionText, fetchMatches, fetchCounts]
  );

  const filterTabs: { status: FilterStatus; label: string }[] = [
    { status: 'PENDING', label: 'Pending' },
    { status: 'APPROVED', label: 'Approved' },
    { status: 'REJECTED', label: 'Rejected' },
    { status: 'ALL', label: 'All' },
  ];

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h1 className={styles.title}>Duplicate Review</h1>
        <p className={styles.subtitle}>
          Review imported podcasts flagged as potential duplicates of existing content
        </p>
      </div>

      <div className={styles.statsBar}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{counts.pending}</span>
          <span className={styles.statLabel}>Pending</span>
        </div>
        <div className={styles.statCard}>
          <span className={`${styles.statValue} ${styles.statApproved}`}>{counts.approved}</span>
          <span className={styles.statLabel}>Approved</span>
        </div>
        <div className={styles.statCard}>
          <span className={`${styles.statValue} ${styles.statRejected}`}>{counts.rejected}</span>
          <span className={styles.statLabel}>Rejected</span>
        </div>
      </div>

      <div className={styles.tabs}>
        {filterTabs.map((tab) => (
          <button
            key={tab.status}
            type="button"
            className={`${styles.tab} ${statusFilter === tab.status ? styles.tabActive : ''}`}
            onClick={() => {
              setStatusFilter(tab.status);
              setPage(1);
            }}
          >
            {tab.label}
            {tab.status === 'PENDING' && counts.pending > 0 && (
              <span className={styles.tabBadge}>{counts.pending}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className={styles.loading}>Loading duplicate matches...</div>
      ) : matches.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon} aria-hidden="true">
            {statusFilter === 'PENDING' ? (
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            )}
          </div>
          <p className={styles.emptyText}>
            {statusFilter === 'PENDING'
              ? 'No pending duplicate reviews. All clear!'
              : `No ${statusFilter.toLowerCase()} matches found.`}
          </p>
        </div>
      ) : (
        <>
          <div className={styles.resultCount}>
            {total} {total === 1 ? 'match' : 'matches'} found
          </div>

          <div className={styles.matchList}>
            {matches.map((match) => {
              const isActing = acting === match.id;
              const isConfirming = confirmAction?.matchId === match.id;
              const similarityPct = Math.round(match.similarity * 100);

              return (
                <div key={match.id} className={styles.matchCard}>
                  <div className={styles.matchHeader}>
                    <div className={styles.similarityBadge}>
                      <span
                        className={styles.similarityValue}
                        style={{ color: getSimilarityColor(match.similarity) }}
                      >
                        {similarityPct}% match
                      </span>
                      <div className={styles.similarityBar}>
                        <div
                          className={styles.similarityFill}
                          style={{
                            width: `${similarityPct}%`,
                            backgroundColor: getSimilarityColor(match.similarity),
                          }}
                        />
                      </div>
                    </div>
                    <span
                      className={`${styles.statusBadge} ${styles[`status${match.status}`]}`}
                    >
                      {match.status}
                    </span>
                    <span className={styles.matchDate}>{formatDate(match.createdAt)}</span>
                  </div>

                  <div className={styles.comparison}>
                    <div className={styles.podcastSide}>
                      <div className={styles.sideLabel}>
                        <span className={styles.sideLabelIcon} aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </span>
                        Flagged Import
                      </div>
                      <PodcastInfo podcast={match.sourcePodcast} />
                    </div>

                    <div className={styles.divider}>
                      <span className={styles.vsLabel}>VS</span>
                    </div>

                    <div className={styles.podcastSide}>
                      <div className={styles.sideLabel}>
                        <span className={styles.sideLabelIcon} aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </span>
                        Existing Match
                      </div>
                      <PodcastInfo podcast={match.matchedPodcast} />
                    </div>
                  </div>

                  {match.resolution && (
                    <div className={styles.resolutionNote}>
                      <strong>Resolution:</strong> {match.resolution}
                      {match.reviewedAt && (
                        <span className={styles.reviewedAt}>
                          {' '}— {formatDate(match.reviewedAt)}
                        </span>
                      )}
                    </div>
                  )}

                  {match.status === 'PENDING' && (
                    <div className={styles.actionArea}>
                      <textarea
                        className={styles.resolutionInput}
                        placeholder="Optional resolution note..."
                        value={resolutionText[match.id] ?? ''}
                        onChange={(e) =>
                          setResolutionText((prev) => ({
                            ...prev,
                            [match.id]: e.target.value,
                          }))
                        }
                        rows={2}
                        aria-label="Resolution note"
                      />

                      {isConfirming ? (
                        <div className={styles.confirmBar}>
                          <span className={styles.confirmText}>
                            {confirmAction?.action === 'approve'
                              ? 'Approve this import? The podcast will go live.'
                              : 'Reject this import? The podcast will be marked as failed.'}
                          </span>
                          <div className={styles.confirmButtons}>
                            <button
                              type="button"
                              className={styles.confirmYes}
                              onClick={() => resolveMatch(match.id, confirmAction!.action)}
                              disabled={isActing}
                            >
                              {isActing ? 'Processing...' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              className={styles.confirmNo}
                              onClick={() => setConfirmAction(null)}
                              disabled={isActing}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className={styles.approveBtn}
                            onClick={() => setConfirmAction({ matchId: match.id, action: 'approve' })}
                            disabled={isActing}
                          >
                            Approve Import
                          </button>
                          <button
                            type="button"
                            className={styles.rejectBtn}
                            onClick={() => setConfirmAction({ matchId: match.id, action: 'reject' })}
                            disabled={isActing}
                          >
                            Reject as Duplicate
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button
                type="button"
                className={styles.pageBtn}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Previous
              </button>
              <span className={styles.pageInfo}>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className={styles.pageBtn}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PodcastInfo({ podcast }: { podcast: MatchPodcast }) {
  const creatorName = podcast.user.name || podcast.user.handle || 'Unknown';

  return (
    <div className={styles.podcastInfo}>
      <Link href={`/podcast/${podcast.id}`} className={styles.podcastTitle} target="_blank">
        {podcast.title}
      </Link>

      <div className={styles.podcastMeta}>
        <div className={styles.creator}>
          {podcast.user.image && (
            <Image
              src={podcast.user.image}
              alt=""
              width={20}
              height={20}
              className={styles.creatorAvatar}
            />
          )}
          <span className={styles.creatorName}>{creatorName}</span>
        </div>

        <div className={styles.metaRow}>
          <span className={styles.metaItem}>{formatDuration(podcast.duration)}</span>
          {podcast.sourcePlatform && (
            <span className={styles.metaItem}>{podcast.sourcePlatform}</span>
          )}
          {podcast.isHumanContent && (
            <span className={styles.humanBadge}>Human</span>
          )}
        </div>

        <span className={styles.metaDate}>{formatDate(podcast.createdAt)}</span>
      </div>

      {podcast.audioUrl && (
        <audio
          controls
          preload="none"
          className={styles.audioPlayer}
          aria-label={`Audio preview for ${podcast.title}`}
        >
          <source src={podcast.audioUrl} type="audio/mpeg" />
        </audio>
      )}
    </div>
  );
}
