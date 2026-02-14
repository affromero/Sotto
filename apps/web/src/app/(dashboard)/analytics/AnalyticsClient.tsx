'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart } from '@/components/ui/BarChart';
import { TimeSeriesChart } from '@/components/ui/TimeSeriesChart';
import { Spinner } from '@/components/ui/Spinner';
import type { AnalyticsResponse } from '@/types/analytics';
import styles from './page.module.css';

const PERIODS = [
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: '90d', label: '90 Days' },
  { value: 'all', label: 'All Time' },
] as const;

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function AnalyticsClient() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/analytics?period=${p}`);
      if (response.ok) {
        const result = await response.json();
        setData(result);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics(period);
  }, [period, fetchAnalytics]);

  const handlePeriodChange = (p: string) => {
    setPeriod(p);
  };

  if (loading && !data) {
    return (
      <div className={styles.loading}>
        <Spinner />
      </div>
    );
  }

  if (!data) return null;

  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>Analytics</h1>
        <div className={styles.periodSelector}>
          {PERIODS.map(({ value, label }) => (
            <button
              key={value}
              className={`${styles.periodBtn} ${period === value ? styles.periodBtnActive : ''}`}
              onClick={() => handlePeriodChange(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

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
