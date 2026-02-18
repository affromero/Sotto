import {
  getDAU_WAU_MAU,
  getDailyActiveUsers,
  getRetentionCohorts,
} from '@/lib/retention-metrics';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

function cellStyle(pct: number): string {
  if (pct > 50) return styles.cohortCellGreen;
  if (pct >= 20) return styles.cohortCellYellow;
  if (pct > 0) return styles.cohortCellRed;
  return styles.cohortCellEmpty;
}

export default async function AdminRetentionPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params.range ?? '30';
  const days = [30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 30;

  const [activeUsers, dauTrend, cohorts] = await Promise.all([
    getDAU_WAU_MAU(),
    getDailyActiveUsers(days),
    getRetentionCohorts(12),
  ]);

  const maxDau = Math.max(...dauTrend.map((d) => d.count), 1);
  const maxWeekOffset = Math.max(...cohorts.map((c) => c.retentionByWeek.length), 0);

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Retention Dashboard</h1>
          <p className={styles.subtitle}>Active users, stickiness, and weekly cohort retention</p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {[30, 90].map((d) => (
            <a
              key={d}
              href={`/admin/retention?range=${d}`}
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
          <span className={styles.cardLabel}>DAU</span>
          <span className={styles.cardValue}>{activeUsers.dau.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>WAU</span>
          <span className={styles.cardValue}>{activeUsers.wau.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>MAU</span>
          <span className={styles.cardValue}>{activeUsers.mau.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>DAU/MAU Stickiness</span>
          <span className={styles.cardValue}>
            {Math.round(activeUsers.stickiness * 100)}%
          </span>
        </div>
      </div>

      {/* DAU trend chart */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Daily Active Users</h2>
        {dauTrend.length === 0 ? (
          <p className={styles.empty}>No activity data yet.</p>
        ) : (
          <div className={styles.chartContainer} role="img" aria-label="Daily active users bar chart">
            {dauTrend.map((d) => (
              <div key={d.day} className={styles.chartBar}>
                <div
                  className={styles.chartBarFill}
                  style={{ height: `${(d.count / maxDau) * 100}%` }}
                  title={`${d.day}: ${d.count} active users`}
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

      {/* Retention cohort heatmap */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Weekly Retention Cohorts</h2>
        {cohorts.length === 0 ? (
          <p className={styles.empty}>No cohort data yet.</p>
        ) : (
          <table className={styles.cohortTable}>
            <thead>
              <tr>
                <th>Cohort</th>
                <th>Users</th>
                {Array.from({ length: maxWeekOffset }, (_, i) => (
                  <th key={i}>W{i}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => (
                <tr key={c.cohortWeek}>
                  <td>
                    {new Date(c.cohortWeek + 'T00:00:00').toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </td>
                  <td>{c.signups}</td>
                  {Array.from({ length: maxWeekOffset }, (_, i) => {
                    const pct = c.retentionByWeek[i];
                    return (
                      <td key={i} className={pct !== undefined ? cellStyle(pct) : styles.cohortCellEmpty}>
                        {pct !== undefined ? `${Math.round(pct)}%` : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
