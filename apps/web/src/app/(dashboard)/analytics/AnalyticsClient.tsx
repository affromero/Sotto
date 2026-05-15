'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart } from '@/components/ui/BarChart';
import { TimeSeriesChart } from '@/components/ui/TimeSeriesChart';
import { Spinner } from '@/components/ui/Spinner';
import type { AnalyticsResponse, CreatorAnalyticsResponse } from '@/types/analytics';
import styles from './page.module.css';

const PERIODS = [
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: '90d', label: '90 Days' },
  { value: 'all', label: 'All Time' },
] as const;

type Tab = 'podcasts' | 'api';

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}

interface AnalyticsClientProps {
  hasPodcasts: boolean;
}

export function AnalyticsClient({ hasPodcasts }: AnalyticsClientProps) {
  const [tab, setTab] = useState<Tab>(hasPodcasts ? 'podcasts' : 'api');
  const [period, setPeriod] = useState('30d');
  const [apiData, setApiData] = useState<AnalyticsResponse | null>(null);
  const [creatorData, setCreatorData] = useState<CreatorAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (p: string, t: Tab) => {
    setLoading(true);
    try {
      if (t === 'api') {
        const response = await fetch(`/api/analytics?period=${p}`);
        if (response.ok) setApiData(await response.json());
      } else {
        const response = await fetch(`/api/creator-analytics?period=${p}`);
        if (response.ok) setCreatorData(await response.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(period, tab);
  }, [period, tab, fetchData]);

  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>Analytics</h1>
        <div className={styles.periodSelector}>
          {PERIODS.map(({ value, label }) => (
            <button
              key={value}
              className={`${styles.periodBtn} ${period === value ? styles.periodBtnActive : ''}`}
              onClick={() => setPeriod(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.tabBar} role="tablist" aria-label="Analytics tabs">
        <button
          role="tab"
          aria-selected={tab === 'podcasts'}
          className={`${styles.tab} ${tab === 'podcasts' ? styles.tabActive : ''}`}
          onClick={() => setTab('podcasts')}
          type="button"
        >
          Podcast Performance
        </button>
        <button
          role="tab"
          aria-selected={tab === 'api'}
          className={`${styles.tab} ${tab === 'api' ? styles.tabActive : ''}`}
          onClick={() => setTab('api')}
          type="button"
        >
          API Usage
        </button>
      </div>

      {loading && !apiData && !creatorData ? (
        <div className={styles.loading}>
          <Spinner />
        </div>
      ) : tab === 'podcasts' ? (
        <PodcastPerformanceTab data={creatorData} hasPodcasts={hasPodcasts} loading={loading} />
      ) : (
        <ApiUsageTab data={apiData} />
      )}
    </>
  );
}

function PodcastPerformanceTab({
  data,
  hasPodcasts,
  loading,
}: {
  data: CreatorAnalyticsResponse | null;
  hasPodcasts: boolean;
  loading: boolean;
}) {
  if (!hasPodcasts) {
    return (
      <div className={styles.upgradeCard}>
        <h2 className={styles.upgradeTitle}>No Podcasts Yet</h2>
        <p className={styles.upgradeText}>
          Create your first podcast to see performance analytics, audience insights, and private
          activity.
        </p>
        <Link href="/create" className={styles.upgradeLink}>
          Create a Podcast
        </Link>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className={styles.loading}>
        <Spinner />
      </div>
    );
  }

  const maxDailyPlays = Math.max(...data.dailyPlays.map((d) => d.plays), 1);

  return (
    <>
      <section className={styles.stats} aria-label="Podcast performance summary">
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Plays</span>
          <span className={styles.statValue}>{data.overview.totalPlays.toLocaleString()}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Unique Listeners</span>
          <span className={styles.statValue}>{data.overview.uniqueListeners.toLocaleString()}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Avg Completion</span>
          <span className={styles.statValue}>{Math.round(data.overview.avgCompletion)}%</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Listen Hours</span>
          <span className={styles.statValue}>{formatHours(data.overview.totalListenHours)}</span>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Daily Plays</h2>
        {data.dailyPlays.length === 0 ? (
          <p className={styles.empty}>No playback data for this period.</p>
        ) : (
          <div className={styles.chartContainer} role="img" aria-label="Daily plays bar chart">
            {data.dailyPlays.map((d) => (
              <div key={d.day} className={styles.chartBar}>
                <div
                  className={styles.chartBarFill}
                  style={{ height: `${(d.plays / maxDailyPlays) * 100}%` }}
                  title={`${d.day}: ${d.plays} plays`}
                />
                <span className={styles.chartLabel}>
                  {new Date(d.day + 'T00:00:00').toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {data.topPodcasts.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Top Podcasts</h2>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Plays</th>
                  <th>Completion</th>
                  <th>Saves</th>
                  <th>Questions</th>
                </tr>
              </thead>
              <tbody>
                {data.topPodcasts.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/podcast/${p.id}/analytics`} className={styles.podcastLink}>
                        {p.title || 'Untitled'}
                      </Link>
                    </td>
                    <td>{p.plays.toLocaleString()}</td>
                    <td>{Math.round(p.completionPercent)}%</td>
                    <td>{p.saves.toLocaleString()}</td>
                    <td>{p.questions.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Private Activity</h2>
        <BarChart
          items={[
            { label: 'Saves', value: data.privateActivity.saves },
            { label: 'Questions', value: data.privateActivity.questions },
            { label: 'Answered', value: data.privateActivity.answered },
            { label: 'Incorporated', value: data.privateActivity.incorporated },
            { label: 'Ratings', value: data.privateActivity.ratings },
          ].filter((i) => i.value > 0)}
          formatValue={(v) => v.toLocaleString()}
        />
      </section>

      {(data.audienceInsights.devices.length > 0 || data.audienceInsights.sources.length > 0) && (
        <div className={styles.columns}>
          {data.audienceInsights.devices.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Devices</h2>
              <BarChart
                items={data.audienceInsights.devices.map((d) => ({
                  label: d.device,
                  value: d.count,
                }))}
                formatValue={(v) => v.toLocaleString()}
              />
            </section>
          )}
          {data.audienceInsights.sources.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Traffic Sources</h2>
              <BarChart
                items={data.audienceInsights.sources.map((s) => ({
                  label: s.source,
                  value: s.count,
                }))}
                formatValue={(v) => v.toLocaleString()}
              />
            </section>
          )}
        </div>
      )}
    </>
  );
}

function ApiUsageTab({ data }: { data: AnalyticsResponse | null }) {
  if (!data) return null;

  return (
    <>
      <section className={styles.stats} aria-label="Usage summary">
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Cost</span>
          <span className={styles.statValue}>{formatCost(data.summary.totalCost)}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>API Requests</span>
          <span className={styles.statValue}>{data.summary.totalRequests.toLocaleString()}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Avg Duration</span>
          <span className={styles.statValue}>{formatDuration(data.summary.avgDurationMs)}</span>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Cost by Service</h2>
        <BarChart
          items={data.byService.map((s) => ({
            label: s.service,
            value: s.totalCost,
          }))}
          formatValue={formatCost}
        />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Requests by Category</h2>
        <BarChart
          items={data.byCategory.map((c) => ({
            label: c.category.replace(/_/g, ' '),
            value: c.count,
          }))}
          formatValue={(v) => v.toLocaleString()}
        />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Usage Over Time</h2>
        <TimeSeriesChart
          data={data.timeSeries.map((d) => ({
            date: d.date,
            value: d.count,
          }))}
        />
      </section>
    </>
  );
}
