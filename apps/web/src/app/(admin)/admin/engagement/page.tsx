import {
  getPrivateActivityOverview,
  getDailyPrivateActivityTrend,
  getTopSaved,
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
  const since = (() => {
    const today = startOfDay(new Date());
    if (rangeParam === 'today') return today;
    if (rangeParam === 'yesterday') return subDays(today, 1);
    const days = [7, 30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 30;
    return subDays(today, days);
  })();

  const [overview, dailyTrend, topSaved, interactions] = await Promise.all([
    getPrivateActivityOverview(since),
    getDailyPrivateActivityTrend(since),
    getTopSaved(5),
    getInteractionStats(since),
  ]);

  const maxDaily = Math.max(...dailyTrend.map((d) => d.saves + d.questions), 1);

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Private Activity</h1>
          <p className={styles.subtitle}>Saves, in-player questions, and creator feedback</p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {[
            { value: 'today', label: 'Today' },
            { value: 'yesterday', label: 'Yesterday' },
            { value: '7', label: '7d' },
            { value: '30', label: '30d' },
            { value: '90', label: '90d' },
          ].map(({ value, label }) => (
            <a
              key={value}
              href={`/admin/engagement?range=${value}`}
              className={`${styles.rangeLink} ${rangeParam === value ? styles.rangeLinkActive : ''}`}
              aria-current={rangeParam === value ? 'page' : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
      </div>

      {/* Top cards */}
      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Saves</span>
          <span className={styles.cardValue}>{overview.saves.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Questions</span>
          <span className={styles.cardValue}>{overview.questions.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Answered</span>
          <span className={styles.cardValue}>{overview.answered.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Incorporated</span>
          <span className={styles.cardValue}>{overview.incorporated.toLocaleString()}</span>
        </div>
      </div>

      {/* Daily private activity trend */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Daily Private Activity</h2>
        {dailyTrend.length === 0 ? (
          <p className={styles.empty}>No private activity data yet.</p>
        ) : (
          <div
            className={styles.chartContainer}
            role="img"
            aria-label="Daily private activity bar chart"
          >
            {dailyTrend.map((d) => {
              const total = d.saves + d.questions;
              return (
                <div key={d.day} className={styles.chartBar}>
                  <div
                    className={styles.chartBarFill}
                    style={{ height: `${(total / maxDaily) * 100}%` }}
                    title={`${d.day}: ${d.saves} saves, ${d.questions} questions`}
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
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Most Saved</h2>
        {topSaved.length === 0 ? (
          <p className={styles.empty}>No saved podcasts yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Podcast</th>
                <th>Saves</th>
              </tr>
            </thead>
            <tbody>
              {topSaved.map((p) => (
                <tr key={p.id}>
                  <td>{p.title ?? 'Untitled'}</td>
                  <td>{p.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Private question stats */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Private Questions</h2>
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
              {pct(
                interactions.helpfulCount,
                interactions.helpfulCount + interactions.unhelpfulCount
              )}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
