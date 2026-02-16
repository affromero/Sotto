'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TwitterConfigData, TrendTopic } from '@/types/twitter';
import styles from './TrendsSection.module.css';

export function TrendsSection() {
  const [config, setConfig] = useState<TwitterConfigData | null>(null);
  const [trends, setTrends] = useState<TrendTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);
  const [newQuery, setNewQuery] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [configRes, trendsRes] = await Promise.all([
        fetch('/api/admin/twitter/config'),
        fetch('/api/admin/twitter/trends'),
      ]);

      if (!configRes.ok) throw new Error('Failed to load config');
      setConfig(await configRes.json());

      if (trendsRes.ok) {
        const trendsData = await trendsRes.json();
        setTrends(trendsData.trends);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

  const handleGenerate = async (trend: TrendTopic, idx: number) => {
    setGeneratingIdx(idx);
    setError(null);

    try {
      const res = await fetch('/api/admin/twitter/trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tweetText: trend.topTweet.text,
          tweetId: trend.topTweet.id,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to generate');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate');
    } finally {
      setGeneratingIdx(null);
    }
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

      {trends.length > 0 && (
        <div className={styles.trendsPanel}>
          <h3 className={styles.subTitle}>Current Trending Topics</h3>
          <div className={styles.trendCards}>
            {trends.map((trend, idx) => (
              <div key={trend.query} className={styles.trendCard}>
                <div className={styles.trendHeader}>
                  <span className={styles.trendQuery}>{trend.query}</span>
                  <span className={styles.trendScore}>
                    Score: {trend.engagementScore}
                  </span>
                </div>
                <p className={styles.trendText}>{trend.topTweet.text}</p>
                <div className={styles.trendFooter}>
                  <span className={styles.trendMeta}>
                    {trend.tweetCount} tweets found
                  </span>
                  <button
                    type="button"
                    className={styles.generateButton}
                    onClick={() => handleGenerate(trend, idx)}
                    disabled={generatingIdx === idx}
                  >
                    {generatingIdx === idx ? 'Generating...' : 'Generate Podcast'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
