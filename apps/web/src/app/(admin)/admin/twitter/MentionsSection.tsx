'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TweetMentionStatus } from '@prisma/client';
import styles from './MentionsSection.module.css';

const STATUSES: TweetMentionStatus[] = [
  'PENDING',
  'PARSING',
  'GENERATING',
  'READY',
  'REPLIED',
  'FAILED',
  'IGNORED',
];

interface MentionUser {
  name: string | null;
  handle: string | null;
  image: string | null;
}

interface MentionPodcast {
  id: string;
  title: string | null;
  status: string;
}

interface MentionRecord {
  id: string;
  tweetId: string;
  authorId: string;
  text: string;
  parsedTopic: string | null;
  status: TweetMentionStatus;
  podcastId: string | null;
  replyTweetId: string | null;
  parentTweetId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  user: MentionUser | null;
  podcast: MentionPodcast | null;
}

interface MentionsResponse {
  mentions: MentionRecord[];
  total: number;
  page: number;
  totalPages: number;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getPageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | 'ellipsis')[] = [1];

  if (current > 3) pages.push('ellipsis');

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 2) pages.push('ellipsis');

  pages.push(total);
  return pages;
}

export function MentionsSection() {
  const [data, setData] = useState<MentionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<TweetMentionStatus | ''>('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchMentions = useCallback(async (s: TweetMentionStatus | '', q: string, p: number) => {
    const params = new URLSearchParams();
    if (s) params.set('status', s);
    if (q) params.set('search', q);
    params.set('page', String(p));
    params.set('limit', '20');

    const qs = params.toString();
    const res = await fetch(`/api/admin/twitter/mentions?${qs}`);
    if (!res.ok) throw new Error('Failed to load mentions');
    return res.json() as Promise<MentionsResponse>;
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMentions(status, search, page);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [fetchMentions, status, search, page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const handleStatusChange = (newStatus: TweetMentionStatus | '') => {
    setStatus(newStatus);
    setPage(1);
  };

  const toggleExpanded = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className={styles.section}>
      <div className={styles.toolbar}>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="mention-status-filter">
            Status
          </label>
          <select
            id="mention-status-filter"
            className={styles.filterSelect}
            value={status}
            onChange={(e) => handleStatusChange(e.target.value as TweetMentionStatus | '')}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="mention-search">
            Search
          </label>
          <input
            id="mention-search"
            type="text"
            className={styles.searchInput}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Tweet text, topic, or author ID..."
          />
        </div>

        <div className={styles.toolbarRight}>
          {data && (
            <span className={styles.totalCount}>
              {data.total} mention{data.total !== 1 ? 's' : ''}
            </span>
          )}
          <button
            type="button"
            className={styles.refreshButton}
            onClick={loadData}
            disabled={loading}
            aria-label="Refresh mentions"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {!loading && data && data.mentions.length === 0 && (
        <div className={styles.emptyState}>
          No mentions found{status ? ` with status ${status}` : ''}{search ? ` matching "${search}"` : ''}.
        </div>
      )}

      {data && data.mentions.length > 0 && (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tweet</th>
                <th>Author</th>
                <th>Topic</th>
                <th>Status</th>
                <th>Podcast</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {data.mentions.map((m) => (
                <>
                  <tr
                    key={m.id}
                    className={styles.clickableRow}
                    onClick={() => toggleExpanded(m.id)}
                    aria-expanded={expandedId === m.id}
                  >
                    <td className={styles.tweetText} title={m.text}>
                      {m.text}
                    </td>
                    <td className={styles.authorCell}>
                      {m.user ? (
                        <>
                          <span className={styles.authorName}>{m.user.name}</span>
                          {m.user.handle && (
                            <span className={styles.authorHandle}>@{m.user.handle}</span>
                          )}
                        </>
                      ) : (
                        <span className={styles.authorId}>{m.authorId}</span>
                      )}
                    </td>
                    <td className={styles.topicCell} title={m.parsedTopic ?? undefined}>
                      {m.parsedTopic ?? '—'}
                    </td>
                    <td>
                      <span className={`${styles.badge} ${styles[`badge${m.status}`] || ''}`}>
                        {m.status}
                      </span>
                    </td>
                    <td>
                      {m.podcast ? (
                        <a
                          href={`/podcast/${m.podcast.id}`}
                          className={styles.podcastLink}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {m.podcast.title || 'Untitled'}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={styles.dateCell} suppressHydrationWarning>
                      {formatDate(m.createdAt)}
                    </td>
                  </tr>

                  {expandedId === m.id && (
                    <tr key={`${m.id}-expanded`} className={styles.expandedRow}>
                      <td colSpan={6}>
                        <div className={styles.expandedContent}>
                          <div className={styles.expandedField}>
                            <span className={styles.expandedLabel}>Full Tweet</span>
                            <span className={styles.expandedValue}>{m.text}</span>
                          </div>

                          {m.parsedTopic && (
                            <div className={styles.expandedField}>
                              <span className={styles.expandedLabel}>Parsed Topic</span>
                              <span className={styles.expandedValue}>{m.parsedTopic}</span>
                            </div>
                          )}

                          {m.errorMessage && (
                            <div className={styles.expandedField}>
                              <span className={styles.expandedLabel}>Error</span>
                              <span className={`${styles.expandedValue} ${styles.errorValue}`}>
                                {m.errorMessage}
                              </span>
                            </div>
                          )}

                          {m.podcast && (
                            <div className={styles.expandedField}>
                              <span className={styles.expandedLabel}>Podcast Status</span>
                              <span className={styles.expandedValue}>
                                {m.podcast.title} — {m.podcast.status}
                              </span>
                            </div>
                          )}

                          <div className={styles.expandedLinks}>
                            <a
                              href={`https://x.com/i/status/${m.tweetId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.viewLink}
                            >
                              View on X
                            </a>
                            {m.parentTweetId && (
                              <a
                                href={`https://x.com/i/status/${m.parentTweetId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.viewLink}
                              >
                                View Parent Tweet
                              </a>
                            )}
                            {m.replyTweetId && (
                              <a
                                href={`https://x.com/i/status/${m.replyTweetId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.viewLink}
                              >
                                View Reply
                              </a>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>

          {data.totalPages > 1 && (
            <nav className={styles.pagination} aria-label="Mentions pagination">
              <button
                type="button"
                className={styles.pageButton}
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 1}
                aria-label="Previous page"
              >
                ‹
              </button>

              {getPageNumbers(page, data.totalPages).map((p, i) =>
                p === 'ellipsis' ? (
                  <span key={`e${i}`} className={styles.pageEllipsis}>
                    ...
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    className={`${styles.pageButton} ${p === page ? styles.pageButtonActive : ''}`}
                    onClick={() => setPage(p)}
                    aria-current={p === page ? 'page' : undefined}
                  >
                    {p}
                  </button>
                ),
              )}

              <button
                type="button"
                className={styles.pageButton}
                onClick={() => setPage((p) => p + 1)}
                disabled={page === data.totalPages}
                aria-label="Next page"
              >
                ›
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
