import {
  getEngagementOverview,
  getDailyEngagementTrend,
  getTopLiked,
  getTopForked,
  getTopCommented,
  getInteractionStats,
} from '@/lib/engagement-metrics';
import { subDays, startOfDay } from 'date-fns';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

function pct(num: number, denom: number): string {
  if (denom === 0) return '0%';
  return `${Math.round((num / denom) * 100)}%`;
}

export default async function AdminEngagementPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params.range ?? '30';
  const days = [7, 30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 30;
  const since = subDays(startOfDay(new Date()), days);

  const [overview, dailyTrend, topLiked, topForked, topCommented, interactions] = await Promise.all([
    getEngagementOverview(since),
    getDailyEngagementTrend(since),
    getTopLiked(5),
    getTopForked(5),
    getTopCommented(5),
    getInteractionStats(since),
  ]);

  const maxDaily = Math.max(
    ...dailyTrend.map((d) => d.likes + d.saves + d.comments + d.forks),
    1
  );

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Engagement Dashboard</h1>
          <p className={styles.subtitle}>Social engagement, top content, and Q&A metrics</p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {[7, 30, 90].map((d) => (
            <a
              key={d}
              href={`/admin/engagement?range=${d}`}
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
          <span className={styles.cardLabel}>Likes</span>
          <span className={styles.cardValue}>{overview.likes.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Saves</span>
          <span className={styles.cardValue}>{overview.saves.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Comments</span>
          <span className={styles.cardValue}>{overview.comments.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Forks</span>
          <span className={styles.cardValue}>{overview.forks.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Follows</span>
          <span className={styles.cardValue}>{overview.follows.toLocaleString()}</span>
        </div>
      </div>

      {/* Daily engagement trend */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Daily Engagement</h2>
        {dailyTrend.length === 0 ? (
          <p className={styles.empty}>No engagement data yet.</p>
        ) : (
          <div className={styles.chartContainer} role="img" aria-label="Daily engagement bar chart">
            {dailyTrend.map((d) => {
              const total = d.likes + d.saves + d.comments + d.forks;
              return (
                <div key={d.day} className={styles.chartBar}>
                  <div
                    className={styles.chartBarFill}
                    style={{ height: `${(total / maxDaily) * 100}%` }}
                    title={`${d.day}: ${d.likes} likes, ${d.saves} saves, ${d.comments} comments, ${d.forks} forks`}
                  />
                  <span className={styles.chartLabel}>
                    {new Date(d.day + 'T00:00:00').toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Top content tables */}
      <div className={styles.columns}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Most Liked</h2>
          {topLiked.length === 0 ? (
            <p className={styles.empty}>No liked podcasts yet.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Podcast</th>
                  <th>Likes</th>
                </tr>
              </thead>
              <tbody>
                {topLiked.map((p) => (
                  <tr key={p.id}>
                    <td>{p.title ?? 'Untitled'}</td>
                    <td>{p.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Most Forked</h2>
          {topForked.length === 0 ? (
            <p className={styles.empty}>No forked podcasts yet.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Podcast</th>
                  <th>Forks</th>
                </tr>
              </thead>
              <tbody>
                {topForked.map((p) => (
                  <tr key={p.id}>
                    <td>{p.title ?? 'Untitled'}</td>
                    <td>{p.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Most Commented</h2>
          {topCommented.length === 0 ? (
            <p className={styles.empty}>No commented podcasts yet.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Podcast</th>
                  <th>Comments</th>
                </tr>
              </thead>
              <tbody>
                {topCommented.map((p) => (
                  <tr key={p.id}>
                    <td>{p.title ?? 'Untitled'}</td>
                    <td>{p.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* Q&A stats */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Q&A Interactions</h2>
        <div className={styles.qaGrid}>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Total Questions</span>
            <span className={styles.cardValue}>{interactions.totalQuestions.toLocaleString()}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Answer Rate</span>
            <span className={styles.cardValue}>
              {pct(interactions.answeredCount, interactions.totalQuestions)}
            </span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Incorporation Rate</span>
            <span className={styles.cardValue}>
              {pct(interactions.incorporatedCount, interactions.totalQuestions)}
            </span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Helpful Rate</span>
            <span className={styles.cardValue}>
              {pct(interactions.helpfulCount, interactions.helpfulCount + interactions.unhelpfulCount)}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
