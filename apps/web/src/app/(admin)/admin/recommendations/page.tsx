import Link from 'next/link';
import { subDays, subMonths, startOfDay } from 'date-fns';
import {
  getRecommendationOverview,
  getRecommendationBySurface,
  getRecommendationPositionBias,
  getDailyRecommendationTrend,
  getTopRecommendedPodcasts,
} from '@/lib/recommendation-metrics';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

export default async function AdminRecommendationsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params.range ?? '30';
  const days = [7, 30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 30;
  const since = days === 90 ? subMonths(startOfDay(new Date()), 3) : subDays(startOfDay(new Date()), days);

  const [overview, surfaces, positionBias, dailyTrend, topPodcasts] = await Promise.all([
    getRecommendationOverview(since),
    getRecommendationBySurface(since),
    getRecommendationPositionBias(since),
    getDailyRecommendationTrend(since),
    getTopRecommendedPodcasts(since),
  ]);

  const maxDaily = Math.max(
    ...dailyTrend.map((d) => Math.max(d.impressions, d.clicks)),
    1
  );
  const maxPositionCtr = Math.max(...positionBias.map((p) => p.ctr), 0.01);

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Recommendation Analytics</h1>
          <p className={styles.subtitle}>Funnel performance and position bias</p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {[7, 30, 90].map((d) => (
            <a
              key={d}
              href={`/admin/recommendations?range=${d}`}
              className={`${styles.rangeLink} ${days === d ? styles.rangeLinkActive : ''}`}
              aria-current={days === d ? 'page' : undefined}
            >
              {d}d
            </a>
          ))}
        </nav>
      </div>

      {/* Summary cards */}
      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Impressions</span>
          <span className={styles.cardValue}>{overview.impressions.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Clicks</span>
          <span className={styles.cardValue}>{overview.clicks.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>CTR</span>
          <span className={styles.cardValue}>{overview.ctr}%</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Queue Rate</span>
          <span className={styles.cardValue}>{overview.queueRate}%</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Avg Listen %</span>
          <span className={styles.cardValue}>{overview.avgListenPercent}%</span>
        </div>
      </div>

      {/* Daily trend chart */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Daily Trend</h2>
        {dailyTrend.length === 0 ? (
          <p className={styles.empty}>No recommendation data yet.</p>
        ) : (
          <div className={styles.chartContainer} role="img" aria-label="Daily recommendation trend">
            {dailyTrend.map((d) => (
              <div key={d.day} className={styles.chartBarGroup}>
                <div className={styles.chartBarPair}>
                  <div
                    className={styles.chartBarFill}
                    style={{ height: `${(d.impressions / maxDaily) * 100}%` }}
                    title={`${d.day}: ${d.impressions} impressions`}
                  />
                  <div
                    className={styles.chartBarFillAccent}
                    style={{ height: `${(d.clicks / maxDaily) * 100}%` }}
                    title={`${d.day}: ${d.clicks} clicks`}
                  />
                </div>
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
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} style={{ backgroundColor: 'var(--color-primary)' }} />
            Impressions
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} style={{ backgroundColor: 'var(--color-accent)' }} />
            Clicks
          </span>
        </div>
      </section>

      {/* Surface breakdown */}
      {surfaces.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Surface Breakdown</h2>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Surface</th>
                  <th>Impressions</th>
                  <th>Clicks</th>
                  <th>CTR</th>
                  <th>Queues</th>
                  <th>Queue Rate</th>
                </tr>
              </thead>
              <tbody>
                {surfaces.map((s) => (
                  <tr key={s.surface}>
                    <td>{s.surface}</td>
                    <td>{s.impressions.toLocaleString()}</td>
                    <td>{s.clicks.toLocaleString()}</td>
                    <td>{s.ctr}%</td>
                    <td>{s.queues.toLocaleString()}</td>
                    <td>{s.queueRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Position bias */}
      {positionBias.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Position Bias</h2>
          <div className={styles.hBarContainer}>
            {positionBias.map((p) => (
              <div key={p.position} className={styles.hBarRow}>
                <span className={styles.hBarLabel}>
                  {p.position >= 10 ? '10+' : `#${p.position + 1}`}
                </span>
                <div className={styles.hBarTrack}>
                  <div
                    className={styles.hBarFill}
                    style={{ width: `${(p.ctr / maxPositionCtr) * 100}%` }}
                  />
                </div>
                <span className={styles.hBarValue}>{p.ctr}% CTR</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Top recommended podcasts */}
      {topPodcasts.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Top Recommended Podcasts</h2>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Impressions</th>
                  <th>Clicks</th>
                  <th>CTR</th>
                  <th>Avg Listen %</th>
                </tr>
              </thead>
              <tbody>
                {topPodcasts.map((p) => (
                  <tr key={p.podcastId}>
                    <td>
                      <Link href={`/podcast/${p.podcastId}`} className={styles.podcastLink}>
                        {p.title || 'Untitled'}
                      </Link>
                    </td>
                    <td>{p.impressions.toLocaleString()}</td>
                    <td>{p.clicks.toLocaleString()}</td>
                    <td>{p.ctr}%</td>
                    <td>{p.avgListenPercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
