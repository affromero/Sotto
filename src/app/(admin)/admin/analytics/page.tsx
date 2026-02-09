import { prisma } from '@/lib/prisma';
import { subDays, startOfDay } from 'date-fns';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

async function getAnalytics(days: number) {
  const since = subDays(startOfDay(new Date()), days);

  const [totalPageViews, uniqueSessions, topPages, referrers, devices, dailyVisitors, avgPages] =
    await Promise.all([
      prisma.behavioralEvent.count({
        where: { eventType: 'page.view', createdAt: { gte: since } },
      }),
      prisma.userSession.count({
        where: { startedAt: { gte: since } },
      }),
      prisma.behavioralEvent.groupBy({
        by: ['pageUrl'],
        where: { eventType: 'page.view', createdAt: { gte: since }, pageUrl: { not: null } },
        _count: true,
        orderBy: { _count: { pageUrl: 'desc' } },
        take: 20,
      }),
      prisma.userSession.groupBy({
        by: ['referrer'],
        where: { startedAt: { gte: since }, referrer: { not: null } },
        _count: true,
        orderBy: { _count: { referrer: 'desc' } },
        take: 15,
      }),
      prisma.userSession.groupBy({
        by: ['deviceType'],
        where: { startedAt: { gte: since } },
        _count: true,
      }),
      prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT DATE_TRUNC('day', "startedAt") AS day, COUNT(*)::bigint AS count
      FROM "UserSession"
      WHERE "startedAt" >= ${since}
      GROUP BY DATE_TRUNC('day', "startedAt")
      ORDER BY day ASC
    `,
      prisma.userSession.aggregate({
        where: { startedAt: { gte: since } },
        _avg: { pageCount: true },
      }),
    ]);

  return {
    totalPageViews,
    uniqueSessions,
    avgPagesPerSession: avgPages._avg.pageCount ?? 0,
    topPages: topPages.map((p) => ({
      url: p.pageUrl ?? 'Unknown',
      count: p._count,
    })),
    referrers: referrers.map((r) => ({
      referrer: r.referrer ?? 'Direct',
      count: r._count,
    })),
    devices: devices.map((d) => ({
      type: d.deviceType ?? 'Unknown',
      count: d._count,
    })),
    dailyVisitors: dailyVisitors.map((d) => ({
      day: d.day.toISOString().split('T')[0],
      count: Number(d.count),
    })),
  };
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default async function AdminAnalyticsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params.range ?? '7';
  const days = [7, 30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 7;

  const stats = await getAnalytics(days);

  const totalDeviceCount = stats.devices.reduce((sum, d) => sum + d.count, 0);
  const maxDailyCount = Math.max(...stats.dailyVisitors.map((d) => d.count), 1);

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Site Analytics</h1>
          <p className={styles.subtitle}>Visitor metrics and page view data</p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {[7, 30, 90].map((d) => (
            <a
              key={d}
              href={`/admin/analytics?range=${d}`}
              className={`${styles.rangeLink} ${days === d ? styles.rangeLinkActive : ''}`}
              aria-current={days === d ? 'page' : undefined}
            >
              {d}d
            </a>
          ))}
        </nav>
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Page Views</span>
          <span className={styles.cardValue}>{stats.totalPageViews.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Unique Visitors</span>
          <span className={styles.cardValue}>{stats.uniqueSessions.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Avg Pages / Session</span>
          <span className={styles.cardValue}>{stats.avgPagesPerSession.toFixed(1)}</span>
        </div>
      </div>

      {stats.dailyVisitors.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Visitors Over Time</h2>
          <div className={styles.chartContainer} role="img" aria-label="Daily visitors bar chart">
            {stats.dailyVisitors.map((d) => (
              <div key={d.day} className={styles.chartBar}>
                <div
                  className={styles.chartBarFill}
                  style={{ height: `${(d.count / maxDailyCount) * 100}%` }}
                  title={`${d.day}: ${d.count} visitors`}
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
        </section>
      )}

      <div className={styles.columns}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Top Pages</h2>
          {stats.topPages.length === 0 ? (
            <p className={styles.empty}>No page views yet.</p>
          ) : (
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Page</th>
                    <th className={styles.numberCol}>Views</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topPages.map((p) => (
                    <tr key={p.url}>
                      <td className={styles.urlCell}>{p.url}</td>
                      <td className={styles.numberCol}>{p.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Referrers</h2>
          {stats.referrers.length === 0 ? (
            <p className={styles.empty}>No referrer data yet.</p>
          ) : (
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th className={styles.numberCol}>Visits</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.referrers.map((r) => (
                    <tr key={r.referrer}>
                      <td className={styles.urlCell}>{extractDomain(r.referrer)}</td>
                      <td className={styles.numberCol}>{r.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Device Breakdown</h2>
        {stats.devices.length === 0 ? (
          <p className={styles.empty}>No device data yet.</p>
        ) : (
          <div className={styles.deviceGrid}>
            {stats.devices.map((d) => {
              const pct = totalDeviceCount > 0 ? (d.count / totalDeviceCount) * 100 : 0;
              return (
                <div key={d.type} className={styles.deviceCard}>
                  <span className={styles.deviceType}>{d.type}</span>
                  <span className={styles.deviceCount}>{d.count.toLocaleString()}</span>
                  <div className={styles.deviceBar}>
                    <div className={styles.deviceBarFill} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={styles.devicePct}>{pct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
