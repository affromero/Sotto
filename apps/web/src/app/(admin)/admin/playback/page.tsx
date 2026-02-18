import {
  getPlaybackOverview,
  getSpeedDistribution,
  getCompletionDistribution,
  getDailyListenHours,
} from '@/lib/playback-metrics';
import { subDays, startOfDay } from 'date-fns';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}

function formatSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export default async function AdminPlaybackPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params.range ?? '30';
  const days = [7, 30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 30;
  const since = subDays(startOfDay(new Date()), days);

  const [overview, speedDist, completionDist, dailyHours] = await Promise.all([
    getPlaybackOverview(since),
    getSpeedDistribution(since),
    getCompletionDistribution(since),
    getDailyListenHours(since),
  ]);

  const maxDailyHours = Math.max(...dailyHours.map((d) => d.hours), 0.01);
  const maxSpeed = Math.max(...speedDist.map((s) => s.count), 1);
  const maxCompletion = Math.max(...completionDist.map((c) => c.count), 1);

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Playback Analytics</h1>
          <p className={styles.subtitle}>Listening hours, completion rates, and playback speed</p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {[7, 30, 90].map((d) => (
            <a
              key={d}
              href={`/admin/playback?range=${d}`}
              className={`${styles.rangeLink} ${days === d ? styles.rangeLinkActive : ''}`}
              aria-current={days === d ? 'page' : undefined}
            >
              {d}d
            </a>
          ))}
        </nav>
      </div>

      {/* Top cards */}
      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Listen Hours</span>
          <span className={styles.cardValue}>{formatHours(overview.totalListenHours)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Sessions</span>
          <span className={styles.cardValue}>{overview.sessionCount.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Avg Completion</span>
          <span className={styles.cardValue}>{Math.round(overview.avgCompletionPercent)}%</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Avg Listen Time</span>
          <span className={styles.cardValue}>{formatSeconds(overview.avgListenSeconds)}</span>
        </div>
      </div>

      {/* Daily listen hours chart */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Daily Listen Hours</h2>
        {dailyHours.length === 0 ? (
          <p className={styles.empty}>No playback data yet.</p>
        ) : (
          <div className={styles.chartContainer} role="img" aria-label="Daily listen hours bar chart">
            {dailyHours.map((d) => (
              <div key={d.day} className={styles.chartBar}>
                <div
                  className={styles.chartBarFill}
                  style={{ height: `${(d.hours / maxDailyHours) * 100}%` }}
                  title={`${d.day}: ${formatHours(d.hours)}`}
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

      <div className={styles.columns}>
        {/* Completion distribution */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Completion Distribution</h2>
          {completionDist.length === 0 ? (
            <p className={styles.empty}>No completion data yet.</p>
          ) : (
            <div className={styles.hBarContainer}>
              {completionDist.map((c) => (
                <div key={c.bucket} className={styles.hBarRow}>
                  <span className={styles.hBarLabel}>{c.bucket}</span>
                  <div className={styles.hBarTrack}>
                    <div
                      className={styles.hBarFill}
                      style={{ width: `${(c.count / maxCompletion) * 100}%` }}
                    />
                  </div>
                  <span className={styles.hBarValue}>{c.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Speed distribution */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Speed Distribution</h2>
          {speedDist.length === 0 ? (
            <p className={styles.empty}>No speed data yet.</p>
          ) : (
            <div className={styles.hBarContainer}>
              {speedDist.map((s) => (
                <div key={s.speed} className={styles.hBarRow}>
                  <span className={styles.hBarLabel}>{s.speed}</span>
                  <div className={styles.hBarTrack}>
                    <div
                      className={styles.hBarFillAccent}
                      style={{ width: `${(s.count / maxSpeed) * 100}%` }}
                    />
                  </div>
                  <span className={styles.hBarValue}>{s.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
