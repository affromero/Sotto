import { prisma } from '@/lib/prisma';
import { counters } from '@/lib/redis';
import { subDays, startOfDay } from 'date-fns';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

async function getInspireStats(days: number) {
  const since = subDays(startOfDay(new Date()), days);

  const [
    forYouCount,
    forYouAvg,
    newsCount,
    newsAvg,
    curiosityCount,
    curiosityAvg,
    forYouDaily,
    newsDaily,
    curiosityDaily,
  ] = await Promise.all([
    prisma.apiUsageLog.count({
      where: { category: 'inspire_foryou', createdAt: { gte: since } },
    }),
    prisma.apiUsageLog.aggregate({
      where: { category: 'inspire_foryou', createdAt: { gte: since }, durationMs: { not: null } },
      _avg: { durationMs: true },
    }),
    prisma.apiUsageLog.count({
      where: { category: 'inspire_news', createdAt: { gte: since } },
    }),
    prisma.apiUsageLog.aggregate({
      where: { category: 'inspire_news', createdAt: { gte: since }, durationMs: { not: null } },
      _avg: { durationMs: true },
    }),
    prisma.apiUsageLog.count({
      where: { category: 'inspire_curiosity', createdAt: { gte: since } },
    }),
    prisma.apiUsageLog.aggregate({
      where: { category: 'inspire_curiosity', createdAt: { gte: since }, durationMs: { not: null } },
      _avg: { durationMs: true },
    }),
    prisma.$queryRaw<Array<{ day: Date; calls: bigint; avg_ms: number }>>`
      SELECT DATE_TRUNC('day', "createdAt") AS day,
             COUNT(*)::bigint AS calls,
             AVG("durationMs")::float AS avg_ms
      FROM "ApiUsageLog"
      WHERE category = 'inspire_foryou' AND "createdAt" >= ${since} AND "durationMs" IS NOT NULL
      GROUP BY DATE_TRUNC('day', "createdAt")
      ORDER BY day ASC
    `,
    prisma.$queryRaw<Array<{ day: Date; calls: bigint; avg_ms: number }>>`
      SELECT DATE_TRUNC('day', "createdAt") AS day,
             COUNT(*)::bigint AS calls,
             AVG("durationMs")::float AS avg_ms
      FROM "ApiUsageLog"
      WHERE category = 'inspire_news' AND "createdAt" >= ${since} AND "durationMs" IS NOT NULL
      GROUP BY DATE_TRUNC('day', "createdAt")
      ORDER BY day ASC
    `,
    prisma.$queryRaw<Array<{ day: Date; calls: bigint; avg_ms: number }>>`
      SELECT DATE_TRUNC('day', "createdAt") AS day,
             COUNT(*)::bigint AS calls,
             AVG("durationMs")::float AS avg_ms
      FROM "ApiUsageLog"
      WHERE category = 'inspire_curiosity' AND "createdAt" >= ${since} AND "durationMs" IS NOT NULL
      GROUP BY DATE_TRUNC('day', "createdAt")
      ORDER BY day ASC
    `,
  ]);

  // P95 latency via raw SQL
  const [forYouP95, newsP95, curiosityP95] = await Promise.all([
    prisma.$queryRaw<Array<{ p95: number }>>`
      SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "durationMs")::float AS p95
      FROM "ApiUsageLog"
      WHERE category = 'inspire_foryou' AND "createdAt" >= ${since} AND "durationMs" IS NOT NULL
    `,
    prisma.$queryRaw<Array<{ p95: number }>>`
      SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "durationMs")::float AS p95
      FROM "ApiUsageLog"
      WHERE category = 'inspire_news' AND "createdAt" >= ${since} AND "durationMs" IS NOT NULL
    `,
    prisma.$queryRaw<Array<{ p95: number }>>`
      SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "durationMs")::float AS p95
      FROM "ApiUsageLog"
      WHERE category = 'inspire_curiosity' AND "createdAt" >= ${since} AND "durationMs" IS NOT NULL
    `,
  ]);

  // Cache hit rates from Redis counters (last 7 days)
  const today = new Date();
  const cacheStats: Record<string, { hits: number; misses: number }> = {
    forYou: { hits: 0, misses: 0 },
    news: { hits: 0, misses: 0 },
    curiosity: { hits: 0, misses: 0 },
    trending: { hits: 0, misses: 0 },
  };

  const lookbackDays = Math.min(days, 7);
  const counterPromises: Promise<void>[] = [];
  for (let i = 0; i < lookbackDays; i++) {
    const date = subDays(today, i).toISOString().split('T')[0];
    for (const section of ['forYou', 'news', 'curiosity', 'trending'] as const) {
      counterPromises.push(
        (async () => {
          const [hits, misses] = await Promise.all([
            counters.get(`inspire:hits:${section}:${date}`),
            counters.get(`inspire:misses:${section}:${date}`),
          ]);
          cacheStats[section].hits += hits;
          cacheStats[section].misses += misses;
        })()
      );
    }
  }
  await Promise.all(counterPromises);

  return {
    forYou: {
      totalCalls: forYouCount,
      avgLatencyMs: Math.round(forYouAvg._avg.durationMs ?? 0),
      p95LatencyMs: Math.round(forYouP95[0]?.p95 ?? 0),
      daily: forYouDaily.map((d) => ({
        day: d.day.toISOString().split('T')[0],
        calls: Number(d.calls),
        avgMs: Math.round(d.avg_ms),
      })),
    },
    news: {
      totalCalls: newsCount,
      avgLatencyMs: Math.round(newsAvg._avg.durationMs ?? 0),
      p95LatencyMs: Math.round(newsP95[0]?.p95 ?? 0),
      daily: newsDaily.map((d) => ({
        day: d.day.toISOString().split('T')[0],
        calls: Number(d.calls),
        avgMs: Math.round(d.avg_ms),
      })),
    },
    curiosity: {
      totalCalls: curiosityCount,
      avgLatencyMs: Math.round(curiosityAvg._avg.durationMs ?? 0),
      p95LatencyMs: Math.round(curiosityP95[0]?.p95 ?? 0),
      daily: curiosityDaily.map((d) => ({
        day: d.day.toISOString().split('T')[0],
        calls: Number(d.calls),
        avgMs: Math.round(d.avg_ms),
      })),
    },
    cache: Object.entries(cacheStats).map(([section, { hits, misses }]) => {
      const total = hits + misses;
      return {
        section,
        hits,
        misses,
        hitRate: total > 0 ? Math.round((hits / total) * 100) : 0,
      };
    }),
  };
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

export default async function AdminInspirePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params.range ?? '7';
  const days = [7, 30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 7;

  const stats = await getInspireStats(days);

  const maxForYouCalls = Math.max(...stats.forYou.daily.map((d) => d.calls), 1);
  const maxNewsCalls = Math.max(...stats.news.daily.map((d) => d.calls), 1);
  const maxCuriosityCalls = Math.max(...stats.curiosity.daily.map((d) => d.calls), 1);

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Inspire Me Metrics</h1>
          <p className={styles.subtitle}>LLM performance, cache efficiency, and usage trends</p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {[7, 30, 90].map((d) => (
            <a
              key={d}
              href={`/admin/inspire?range=${d}`}
              className={`${styles.rangeLink} ${days === d ? styles.rangeLinkActive : ''}`}
              aria-current={days === d ? 'page' : undefined}
            >
              {d}d
            </a>
          ))}
        </nav>
      </div>

      {/* Top cards grid — 6 cards, 3 columns */}
      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>ForYou Calls</span>
          <span className={styles.cardValue}>{stats.forYou.totalCalls.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>ForYou Avg Latency</span>
          <span className={styles.cardValue}>{formatMs(stats.forYou.avgLatencyMs)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>ForYou P95 Latency</span>
          <span className={styles.cardValue}>{formatMs(stats.forYou.p95LatencyMs)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>News Calls</span>
          <span className={styles.cardValue}>{stats.news.totalCalls.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>News Avg Latency</span>
          <span className={styles.cardValue}>{formatMs(stats.news.avgLatencyMs)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>News P95 Latency</span>
          <span className={styles.cardValue}>{formatMs(stats.news.p95LatencyMs)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Curiosity Calls</span>
          <span className={styles.cardValue}>{stats.curiosity.totalCalls.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Curiosity Avg Latency</span>
          <span className={styles.cardValue}>{formatMs(stats.curiosity.avgLatencyMs)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Curiosity P95 Latency</span>
          <span className={styles.cardValue}>{formatMs(stats.curiosity.p95LatencyMs)}</span>
        </div>
      </div>

      {/* Daily charts — two columns */}
      <div className={styles.columns}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>ForYou — Daily Calls</h2>
          {stats.forYou.daily.length === 0 ? (
            <p className={styles.empty}>No ForYou data yet.</p>
          ) : (
            <div className={styles.chartContainer} role="img" aria-label="ForYou daily calls bar chart">
              {stats.forYou.daily.map((d) => (
                <div key={d.day} className={styles.chartBar}>
                  <div
                    className={styles.chartBarFill}
                    style={{ height: `${(d.calls / maxForYouCalls) * 100}%` }}
                    title={`${d.day}: ${d.calls} calls, avg ${formatMs(d.avgMs)}`}
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

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>News — Daily Calls</h2>
          {stats.news.daily.length === 0 ? (
            <p className={styles.empty}>No News data yet.</p>
          ) : (
            <div className={styles.chartContainer} role="img" aria-label="News daily calls bar chart">
              {stats.news.daily.map((d) => (
                <div key={d.day} className={styles.chartBar}>
                  <div
                    className={styles.chartBarFillAccent}
                    style={{ height: `${(d.calls / maxNewsCalls) * 100}%` }}
                    title={`${d.day}: ${d.calls} calls, avg ${formatMs(d.avgMs)}`}
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

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Curiosity — Daily Calls</h2>
          {stats.curiosity.daily.length === 0 ? (
            <p className={styles.empty}>No Curiosity data yet.</p>
          ) : (
            <div className={styles.chartContainer} role="img" aria-label="Curiosity daily calls bar chart">
              {stats.curiosity.daily.map((d) => (
                <div key={d.day} className={styles.chartBar}>
                  <div
                    className={styles.chartBarFill}
                    style={{ height: `${(d.calls / maxCuriosityCalls) * 100}%` }}
                    title={`${d.day}: ${d.calls} calls, avg ${formatMs(d.avgMs)}`}
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
      </div>

      {/* Cache hit rates */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Cache Hit Rates (last {Math.min(days, 7)} days)</h2>
        <div className={styles.cacheGrid}>
          {stats.cache.map((c) => {
            const total = c.hits + c.misses;
            return (
              <div key={c.section} className={styles.cacheCard}>
                <span className={styles.cacheSection}>{c.section}</span>
                <span className={styles.cacheRate}>{c.hitRate}%</span>
                <div className={styles.cacheBar}>
                  <div
                    className={styles.cacheBarFill}
                    style={{ width: `${c.hitRate}%` }}
                  />
                </div>
                <span className={styles.cacheDetail}>
                  {c.hits} hits / {c.misses} misses ({total} total)
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
