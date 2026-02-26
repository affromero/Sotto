import { prisma } from '@/lib/prisma';
import { WorldHeatmap } from '@/components/admin/WorldHeatmap';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const RANGE_MS: Record<string, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const VALID_RANGES = Object.keys(RANGE_MS);

const RANGE_OPTIONS = [
  { value: '15m', label: '15m' },
  { value: '1h', label: '1h' },
  { value: '1d', label: '24h' },
  { value: '7d', label: '7d' },
];

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

async function getLiveData(ms: number) {
  const since = new Date(Date.now() - ms);

  const [countries, totalActive] = await Promise.all([
    prisma.userSession.groupBy({
      by: ['country'],
      where: { lastSeenAt: { gte: since }, country: { not: null } },
      _count: true,
      orderBy: { _count: { country: 'desc' } },
      take: 50,
    }),
    prisma.userSession.count({
      where: { lastSeenAt: { gte: since } },
    }),
  ]);

  return {
    since: since.toISOString(),
    totalActive,
    countries: countries.map((c) => ({
      country: c.country!,
      count: c._count,
    })),
  };
}

export default async function LiveAnalyticsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const range = VALID_RANGES.includes(params.range ?? '') ? params.range! : '15m';
  const initialData = await getLiveData(RANGE_MS[range]);

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Live Visitors</h1>
          <p className={styles.subtitle}>Real-time visitor map — updates every 30 seconds</p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {RANGE_OPTIONS.map(({ value, label }) => (
            <a
              key={value}
              href={`/admin/analytics/live?range=${value}`}
              className={`${styles.rangeLink} ${range === value ? styles.rangeLinkActive : ''}`}
              aria-current={range === value ? 'page' : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
      <WorldHeatmap initialData={initialData} range={range} />
    </div>
  );
}
