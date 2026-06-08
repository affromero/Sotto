'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TwitterConfigData, TwitterAutoTweetData } from '@/types/twitter';
import styles from './AutoTweetSection.module.css';

export function AutoTweetSection() {
  const [config, setConfig] = useState<TwitterConfigData | null>(null);
  const [autoTweets, setAutoTweets] = useState<TwitterAutoTweetData[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tweetingId, setTweetingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [configRes, tweetsRes] = await Promise.all([
        fetch('/api/admin/twitter/config'),
        fetch('/api/admin/twitter/auto-tweet?limit=20'),
      ]);

      if (!configRes.ok || !tweetsRes.ok) throw new Error('Failed to load data');

      const configData = await configRes.json();
      const tweetsData = await tweetsRes.json();
      setConfig(configData);
      setAutoTweets(tweetsData.autoTweets);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch('/api/admin/twitter/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoTweetEnabled: config.autoTweetEnabled,
          minPlays: config.minPlays,
          tweetTemplate: config.tweetTemplate,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }

      const updated = await res.json();
      setConfig(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleManualTweet = async (podcastId: string) => {
    setTweetingId(podcastId);
    try {
      const res = await fetch('/api/admin/twitter/auto-tweet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ podcastId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to queue tweet');
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to tweet');
    } finally {
      setTweetingId(null);
    }
  };

  if (loading) return <div className={styles.loading}>Loading...</div>;
  if (!config) return <div className={styles.error}>{error || 'Failed to load config'}</div>;

  return (
    <div className={styles.section}>
      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label}>
            <input
              type="checkbox"
              checked={config.autoTweetEnabled}
              onChange={(e) => setConfig({ ...config, autoTweetEnabled: e.target.checked })}
            />
            Enable Auto-Tweet
          </label>
          <span className={styles.hint}>
            Automatically tweet when podcasts reach the private play threshold
          </span>
        </div>

        <div className={styles.thresholds}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="minPlays">
              Min Plays
            </label>
            <input
              id="minPlays"
              type="number"
              className={styles.input}
              value={config.minPlays}
              onChange={(e) =>
                setConfig({ ...config, minPlays: parseInt(e.target.value, 10) || 1 })
              }
              min={1}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="tweetTemplate">
            Tweet Template
          </label>
          <textarea
            id="tweetTemplate"
            className={styles.textarea}
            value={config.tweetTemplate}
            onChange={(e) => setConfig({ ...config, tweetTemplate: e.target.value })}
            rows={3}
          />
          <span className={styles.hint}>
            Variables: {'{{title}}'}, {'{{topic}}'}, {'{{url}}'}. Max 280 chars after interpolation.
          </span>
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <button type="button" className={styles.saveButton} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save Changes'}
        </button>
      </div>

      {autoTweets.length > 0 && (
        <div className={styles.tableWrapper}>
          <h3 className={styles.subTitle}>Recent Auto-Tweets</h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Podcast</th>
                <th>Trigger</th>
                <th>Status</th>
                <th>Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {autoTweets.map((at) => (
                <tr key={at.id}>
                  <td className={styles.truncate}>{at.podcast?.title ?? '—'}</td>
                  <td>{at.trigger}</td>
                  <td>
                    <span className={`${styles.badge} ${styles[`badge${at.status}`] || ''}`}>
                      {at.status}
                    </span>
                  </td>
                  <td>{new Date(at.createdAt).toLocaleDateString()}</td>
                  <td>
                    {at.status !== 'posted' && (
                      <button
                        type="button"
                        className={styles.tweetButton}
                        onClick={() => handleManualTweet(at.podcastId)}
                        disabled={tweetingId === at.podcastId}
                      >
                        {tweetingId === at.podcastId ? 'Queuing...' : 'Tweet'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
