'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TwitterConfigData, TrendTopic, EnrichedTrendTweet } from '@/types/twitter';
import styles from './TrendsSection.module.css';

interface TrendFilters {
  lang: string;
  verified: boolean;
  minEngagement: number;
}

const LANGUAGES = [
  { value: '', label: 'All languages' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'it', label: 'Italian' },
];

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function TrendsSection() {
  const [config, setConfig] = useState<TwitterConfigData | null>(null);
  const [trends, setTrends] = useState<TrendTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [newQuery, setNewQuery] = useState('');
  const [filters, setFilters] = useState<TrendFilters>({
    lang: '',
    verified: false,
    minEngagement: 0,
  });
  const [expandedQueries, setExpandedQueries] = useState<Set<string>>(new Set());

  const loadConfig = useCallback(async () => {
    const res = await fetch('/api/admin/twitter/config');
    if (!res.ok) throw new Error('Failed to load config');
    return res.json();
  }, []);

  const loadTrends = useCallback(async (f: TrendFilters) => {
    const params = new URLSearchParams();
    if (f.lang) params.set('lang', f.lang);
    if (f.verified) params.set('verified', 'true');
    if (f.minEngagement > 0) params.set('minEngagement', String(f.minEngagement));

    const qs = params.toString();
    const res = await fetch(`/api/admin/twitter/trends${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error('Failed to load trends');
    return res.json();
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [configData, trendsData] = await Promise.all([
        loadConfig(),
        loadTrends(filters),
      ]);

      setConfig(configData);
      setTrends(trendsData.trends);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [loadConfig, loadTrends, filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const trendsData = await loadTrends(filters);
      setTrends(trendsData.trends);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh');
    } finally {
      setRefreshing(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch('/api/admin/twitter/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trendPollingEnabled: config.trendPollingEnabled,
          trendPollIntervalMs: config.trendPollIntervalMs,
          maxTrendPodcastsPerDay: config.maxTrendPodcastsPerDay,
          trendSearchQueries: config.trendSearchQueries,
        }),
      });

      if (!res.ok) throw new Error('Failed to save');
      setConfig(await res.json());
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleAddQuery = () => {
    if (!config || !newQuery.trim()) return;
    setConfig({
      ...config,
      trendSearchQueries: [...config.trendSearchQueries, newQuery.trim()],
    });
    setNewQuery('');
  };

  const handleRemoveQuery = (idx: number) => {
    if (!config) return;
    setConfig({
      ...config,
      trendSearchQueries: config.trendSearchQueries.filter((_, i) => i !== idx),
    });
  };

  const handleGenerate = async (tweet: EnrichedTrendTweet) => {
    setGeneratingId(tweet.id);
    setError(null);

    try {
      const res = await fetch('/api/admin/twitter/trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tweetText: tweet.text,
          tweetId: tweet.id,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to generate');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate');
    } finally {
      setGeneratingId(null);
    }
  };

  const toggleExpanded = (query: string) => {
    setExpandedQueries((prev) => {
      const next = new Set(prev);
      if (next.has(query)) {
        next.delete(query);
      } else {
        next.add(query);
      }
      return next;
    });
  };

  if (loading) return <div className={styles.loading}>Loading...</div>;
  if (!config) return <div className={styles.error}>{error || 'Failed to load'}</div>;

  return (
    <div className={styles.section}>
      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label}>
            <input
              type="checkbox"
              checked={config.trendPollingEnabled}
              onChange={(e) => setConfig({ ...config, trendPollingEnabled: e.target.checked })}
            />
            Enable Trend Polling
          </label>
          <span className={styles.hint}>Automatically search trending topics and generate podcasts</span>
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="interval">
              Poll Interval (hours)
            </label>
            <input
              id="interval"
              type="number"
              className={styles.input}
              value={Math.round(config.trendPollIntervalMs / 3600000)}
              onChange={(e) =>
                setConfig({
                  ...config,
                  trendPollIntervalMs: (parseInt(e.target.value, 10) || 2) * 3600000,
                })
              }
              min={1}
              max={24}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="maxPerDay">
              Max Podcasts/Day
            </label>
            <input
              id="maxPerDay"
              type="number"
              className={styles.input}
              value={config.maxTrendPodcastsPerDay}
              onChange={(e) =>
                setConfig({
                  ...config,
                  maxTrendPodcastsPerDay: parseInt(e.target.value, 10) || 1,
                })
              }
              min={1}
              max={20}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Search Queries</label>
          <div className={styles.queryList}>
            {config.trendSearchQueries.map((q, i) => (
              <span key={i} className={styles.queryTag}>
                {q}
                <button
                  type="button"
                  className={styles.removeQuery}
                  onClick={() => handleRemoveQuery(i)}
                  aria-label={`Remove ${q}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className={styles.addQuery}>
            <input
              type="text"
              className={styles.queryInput}
              value={newQuery}
              onChange={(e) => setNewQuery(e.target.value)}
              placeholder="Add query..."
              onKeyDown={(e) => e.key === 'Enter' && handleAddQuery()}
            />
            <button type="button" className={styles.addButton} onClick={handleAddQuery}>
              Add
            </button>
          </div>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <button type="button" className={styles.saveButton} onClick={handleSaveConfig} disabled={saving}>
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save Config'}
        </button>
      </div>

      <div className={styles.trendsPanel}>
        <div className={styles.trendsPanelHeader}>
          <h3 className={styles.subTitle}>Trending Tweets</h3>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh trends"
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className={styles.filtersBar}>
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel} htmlFor="lang-filter">Language</label>
            <select
              id="lang-filter"
              className={styles.filterSelect}
              value={filters.lang}
              onChange={(e) => setFilters({ ...filters, lang: e.target.value })}
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.filterGroup}>
            <label className={styles.filterToggle}>
              <input
                type="checkbox"
                checked={filters.verified}
                onChange={(e) => setFilters({ ...filters, verified: e.target.checked })}
              />
              Verified only
            </label>
          </div>

          <div className={styles.filterGroup}>
            <label className={styles.filterLabel} htmlFor="engagement-filter">Min engagement</label>
            <input
              id="engagement-filter"
              type="number"
              className={styles.filterInput}
              value={filters.minEngagement}
              onChange={(e) =>
                setFilters({ ...filters, minEngagement: parseInt(e.target.value, 10) || 0 })
              }
              min={0}
              step={10}
            />
          </div>
        </div>

        {trends.length === 0 && !refreshing && (
          <div className={styles.emptyState}>No trending tweets found. Try adjusting filters or adding search queries.</div>
        )}

        <div className={styles.trendCards}>
          {trends.map((trend) => {
            const isExpanded = expandedQueries.has(trend.query);
            const visibleTweets = isExpanded ? trend.tweets : trend.tweets.slice(0, 3);
            const hasMore = trend.tweets.length > 3;

            return (
              <div key={trend.query} className={styles.trendGroup}>
                <div className={styles.trendGroupHeader}>
                  <span className={styles.trendQuery}>{trend.query}</span>
                  <span className={styles.trendCount}>
                    {trend.tweets.length} tweet{trend.tweets.length !== 1 ? 's' : ''} matched
                    {trend.totalTweetCount > trend.tweets.length && ` (${trend.totalTweetCount} total)`}
                  </span>
                </div>

                {visibleTweets.map((tweet) => (
                  <div key={tweet.id} className={styles.tweetCard}>
                    <div className={styles.tweetHeader}>
                      <div className={styles.tweetAuthor}>
                        <span className={styles.authorName}>{tweet.authorName}</span>
                        {tweet.authorVerified && (
                          <span
                            className={styles.verifiedBadge}
                            title={tweet.authorVerifiedType === 'business' ? 'Verified organization' : 'Verified'}
                            aria-label="Verified account"
                          >
                            ✓
                          </span>
                        )}
                        <span className={styles.authorHandle}>@{tweet.authorUsername}</span>
                      </div>
                      <span className={styles.tweetScore}>
                        Score: {tweet.engagementScore}
                      </span>
                    </div>

                    <p className={styles.tweetText}>{tweet.text}</p>

                    <div className={styles.tweetFooter}>
                      <div className={styles.tweetMetrics}>
                        <span className={styles.metric} title="Likes">{formatCount(tweet.likeCount)} likes</span>
                        <span className={styles.metricSep}>·</span>
                        <span className={styles.metric} title="Retweets">{formatCount(tweet.retweetCount)} RTs</span>
                        <span className={styles.metricSep}>·</span>
                        <span className={styles.metric} title="Replies">{formatCount(tweet.replyCount)} replies</span>
                      </div>

                      <div className={styles.tweetActions}>
                        <a
                          href={tweet.tweetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.viewLink}
                        >
                          View on X
                        </a>
                        <button
                          type="button"
                          className={styles.generateButton}
                          onClick={() => handleGenerate(tweet)}
                          disabled={generatingId === tweet.id}
                        >
                          {generatingId === tweet.id ? 'Generating...' : 'Generate Podcast'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {hasMore && (
                  <button
                    type="button"
                    className={styles.expandButton}
                    onClick={() => toggleExpanded(trend.query)}
                  >
                    {isExpanded
                      ? 'Show less'
                      : `Show ${trend.tweets.length - 3} more`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
