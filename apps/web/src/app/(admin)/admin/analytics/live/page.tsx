import { prisma } from '@/lib/prisma';
import { WorldHeatmap } from '@/components/admin/WorldHeatmap';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

async function getLiveData() {
  const since = new Date(Date.now() - 15 * 60 * 1000);

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

export default async function LiveAnalyticsPage() {
  const initialData = await getLiveData();

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Live Visitors</h1>
        <p className={styles.subtitle}>Real-time visitor map — updates every 30 seconds</p>
      </div>
      <WorldHeatmap initialData={initialData} />
    </div>
  );
}
