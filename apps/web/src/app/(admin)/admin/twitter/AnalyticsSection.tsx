'use client';

import { useState, useEffect } from 'react';
import styles from './AnalyticsSection.module.css';

interface AnalyticsData {
  mentions: {
    total: number;
    last30Days: number;
    statusBreakdown: Record<string, number>;
  };
  autoTweets: {
    total: number;
    statusBreakdown: Record<string, number>;
    recent: Array<{
      id: string;
      tweetId: string | null;
      trigger: string;
      status: string;
      createdAt: string;
      podcast: { title: string } | null;
    }>;
  };
  podcasts: {
    totalFromTwitter: number;
    successful: number;
    successRate: number;
  };
}

export function AnalyticsSection() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/twitter/analytics')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load analytics');
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.loading}>Loading analytics...</div>;
  if (error) return <div className={styles.error}>{error}</div>;
  if (!data) return null;

  return (
    <div className={styles.section}>
      <div className={styles.cards}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Total Mentions</span>
          <span className={styles.cardValue}>{data.mentions.total}</span>
          <span className={styles.cardSub}>Last 30d: {data.mentions.last30Days}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Twitter Podcasts</span>
          <span className={styles.cardValue}>{data.podcasts.totalFromTwitter}</span>
          <span className={styles.cardSub}>{data.podcasts.successful} successful</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Success Rate</span>
          <span className={styles.cardValue}>{data.podcasts.successRate}%</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Auto-Tweets</span>
          <span className={styles.cardValue}>{data.autoTweets.total}</span>
          <span className={styles.cardSub}>
            {data.autoTweets.statusBreakdown['posted'] ?? 0} posted
          </span>
        </div>
      </div>

      <div className={styles.breakdown}>
        <h3 className={styles.subTitle}>Mention Status Breakdown</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Status</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.mentions.statusBreakdown).map(([status, count]) => (
              <tr key={status}>
                <td>
                  <span className={`${styles.badge} ${styles[`badge${status}`] || ''}`}>
                    {status}
                  </span>
                </td>
                <td>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.autoTweets.recent.length > 0 && (
        <div className={styles.breakdown}>
          <h3 className={styles.subTitle}>Recent Auto-Tweets</h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Podcast</th>
                <th>Trigger</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {data.autoTweets.recent.map((at) => (
                <tr key={at.id}>
                  <td className={styles.truncate}>{at.podcast?.title ?? '—'}</td>
                  <td>{at.trigger}</td>
                  <td>
                    <span className={`${styles.badge} ${styles[`badge${at.status}`] || ''}`}>
                      {at.status}
                    </span>
                  </td>
                  <td>{new Date(at.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
