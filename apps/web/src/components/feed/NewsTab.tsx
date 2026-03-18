'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { NEWS_CATEGORY_LABELS, NEWS_TIME_RANGE_LABELS } from '@sotto/shared';
import type { NewsArticle, NewsCategory, NewsMeta, NewsTimeRange } from '@sotto/shared';
import { NewsCard } from './NewsCard';
import styles from './NewsTab.module.css';

interface NewsTabProps {
  isAuthenticated: boolean;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const TIME_RANGE_KEYS = Object.keys(NEWS_TIME_RANGE_LABELS) as NewsTimeRange[];
const CATEGORY_KEYS = Object.keys(NEWS_CATEGORY_LABELS) as NewsCategory[];

export function NewsTab({ isAuthenticated }: NewsTabProps) {
  const [category, setCategory] = useState<NewsCategory | undefined>(undefined);
  const [timeRange, setTimeRange] = useState<NewsTimeRange>('1w');
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<NewsMeta | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchArticles = useCallback(async (
    opts: { category?: NewsCategory; timeRange: NewsTimeRange; cursor?: string; append?: boolean },
  ) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!opts.append) setLoading(true);

    try {
      const params = new URLSearchParams({ timeRange: opts.timeRange, limit: '20' });
      if (opts.category) params.set('category', opts.category);
      if (opts.cursor) params.set('cursor', opts.cursor);

      const res = await fetch(`/api/news?${params}`, { signal: controller.signal });
      if (!res.ok) return;

      const data = await res.json();
      if (opts.append) {
        setArticles((prev) => [...prev, ...data.articles]);
      } else {
        setArticles(data.articles);
      }
      setNextCursor(data.nextCursor);
      setMeta(data.meta);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchArticles({ category, timeRange });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCategoryChange = useCallback((cat: NewsCategory | undefined) => {
    setCategory(cat);
    setArticles([]);
    setNextCursor(null);
    fetchArticles({ category: cat, timeRange });
  }, [timeRange, fetchArticles]);

  const handleTimeRangeChange = useCallback((tr: NewsTimeRange) => {
    setTimeRange(tr);
    setArticles([]);
    setNextCursor(null);
    fetchArticles({ category, timeRange: tr });
  }, [category, fetchArticles]);

  const handleLoadMore = useCallback(() => {
    if (!nextCursor || loading) return;
    fetchArticles({ category, timeRange, cursor: nextCursor, append: true });
  }, [category, timeRange, nextCursor, loading, fetchArticles]);

  // Infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) handleLoadMore();
      },
      { rootMargin: '200px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleLoadMore]);

  return (
    <div className={styles.container}>
      {/* Source health banner */}
      {meta && (
        <p className={styles.healthBanner}>
          {meta.sourceCount} sources
          {meta.latestFetchedAt && <> &middot; Updated {formatRelativeTime(meta.latestFetchedAt)}</>}
        </p>
      )}

      {/* Category pills */}
      <div className={styles.pillRow} role="radiogroup" aria-label="News category">
        <button
          className={`${styles.pill} ${category === undefined ? styles.pillActive : ''}`}
          onClick={() => handleCategoryChange(undefined)}
          role="radio"
          aria-checked={category === undefined}
          type="button"
        >
          All
        </button>
        {CATEGORY_KEYS.map((cat) => (
          <button
            key={cat}
            className={`${styles.pill} ${category === cat ? styles.pillActive : ''}`}
            onClick={() => handleCategoryChange(cat)}
            role="radio"
            aria-checked={category === cat}
            type="button"
          >
            {NEWS_CATEGORY_LABELS[cat]}
            {meta?.categoryCounts[cat] != null && (
              <span className={styles.pillCount}>{meta.categoryCounts[cat]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Time range pills */}
      <div className={styles.pillRow} role="radiogroup" aria-label="Time range">
        {TIME_RANGE_KEYS.map((tr) => (
          <button
            key={tr}
            className={`${styles.pill} ${timeRange === tr ? styles.pillActive : ''}`}
            onClick={() => handleTimeRangeChange(tr)}
            role="radio"
            aria-checked={timeRange === tr}
            type="button"
          >
            {NEWS_TIME_RANGE_LABELS[tr]}
          </button>
        ))}
      </div>

      {/* Loading skeleton */}
      {loading && articles.length === 0 && (
        <div className={styles.grid} role="status" aria-label="Loading articles">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={styles.skeleton} aria-hidden="true">
              <div className={styles.skeletonHeader} />
              <div className={styles.skeletonTitle} />
              <div className={styles.skeletonSummary} />
              <div className={styles.skeletonActions} />
            </div>
          ))}
          <span className={styles.srOnly}>Loading articles...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && articles.length === 0 && (
        <div className={styles.empty} role="status">
          <p className={styles.emptyText}>No articles found. Try a different time range or category.</p>
        </div>
      )}

      {/* Article grid */}
      {articles.length > 0 && (
        <div className={styles.grid}>
          {articles.map((article) => (
            <NewsCard key={article.id} article={article} isAuthenticated={isAuthenticated} />
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      {nextCursor && (
        <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true">
          {loading && <span className={styles.spinner} />}
        </div>
      )}
    </div>
  );
}
