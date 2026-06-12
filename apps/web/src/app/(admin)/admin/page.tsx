import { prisma } from '@/lib/prisma';
import { DURATION_TOLERANCE_SECONDS } from '@/lib/duration';
import styles from './page.module.css';

async function getDurationAccuracyStats() {
  const [tracked, withinTarget, deviationStats] = await Promise.all([
    prisma.episode.count({
      where: { durationDeviation: { not: null }, status: 'READY' },
    }),
    prisma.episode.count({
      where: {
        durationDeviation: {
          gte: -DURATION_TOLERANCE_SECONDS,
          lte: DURATION_TOLERANCE_SECONDS,
        },
        status: 'READY',
      },
    }),
    prisma.$queryRaw<[{ mean_abs: number | null; avg_dev: number | null }]>`
      SELECT
        AVG(ABS("durationDeviation"))::float AS mean_abs,
        AVG("durationDeviation")::float AS avg_dev
      FROM "Episode"
      WHERE "durationDeviation" IS NOT NULL
        AND "status" = 'READY'
        AND "deletedAt" IS NULL
    `,
  ]);

  return {
    tracked,
    withinTargetPct: tracked > 0 ? Math.round((withinTarget / tracked) * 100) : 0,
    meanAbsDeviation: Math.round(deviationStats[0]?.mean_abs ?? 0),
    avgDeviation: Math.round(deviationStats[0]?.avg_dev ?? 0),
  };
}

async function getOverviewStats() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today);
  monthAgo.setDate(monthAgo.getDate() - 30);

  const [
    totalUsers,
    totalEpisodes,
    readyEpisodes,
    failedEpisodes,
    signupsToday,
    signupsThisWeek,
    signupsThisMonth,
    totalPlays,
    apiCostAgg,
    pipelineAttempted,
    pipelineFailed,
    byokUsersRow,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.episode.count(),
    prisma.episode.count({ where: { status: 'READY' } }),
    prisma.episode.count({ where: { status: 'FAILED' } }),
    prisma.user.count({
      where: { createdAt: { gte: today } },
    }),
    prisma.user.count({
      where: { createdAt: { gte: weekAgo } },
    }),
    prisma.user.count({
      where: { createdAt: { gte: monthAgo } },
    }),
    prisma.episode.aggregate({
      _sum: { playCount: true },
    }),
    // API costs (30d)
    prisma.apiUsageLog.aggregate({
      where: { createdAt: { gte: monthAgo } },
      _sum: { totalCost: true },
    }),
    // Pipeline (30d)
    prisma.episode.count({
      where: { createdAt: { gte: monthAgo }, source: { not: 'IMPORT' } },
    }),
    prisma.episode.count({
      where: { createdAt: { gte: monthAgo }, status: 'FAILED', source: { not: 'IMPORT' } },
    }),
    // BYOK users
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT ak."userId")::bigint AS count
      FROM "UserAiKey" ak
      JOIN "UserTtsKey" tk ON tk."userId" = ak."userId"
      WHERE ak."isValid" = true AND tk."isValid" = true
    `,
  ]);

  return {
    totalUsers,
    totalEpisodes,
    readyEpisodes,
    failedEpisodes,
    signupsToday,
    signupsThisWeek,
    signupsThisMonth,
    totalPlays: totalPlays._sum.playCount ?? 0,
    apiCosts: apiCostAgg._sum.totalCost ?? 0,
    pipelineSuccessRate:
      pipelineAttempted > 0
        ? Math.round(((pipelineAttempted - pipelineFailed) / pipelineAttempted) * 100)
        : 0,
    byokUsers: Number(byokUsersRow[0]?.count ?? 0),
  };
}

export default async function AdminOverviewPage() {
  const [stats, durationStats] = await Promise.all([
    getOverviewStats(),
    getDurationAccuracyStats(),
  ]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Admin Overview</h1>
        <p className={styles.subtitle}>Platform-wide statistics and metrics</p>
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardLabel}>Total Users</span>
          </div>
          <div className={styles.cardValue}>{stats.totalUsers.toLocaleString()}</div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardLabel}>Total Lessons</span>
          </div>
          <div className={styles.cardValue}>{stats.totalEpisodes.toLocaleString()}</div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardLabel}>Ready Lessons</span>
          </div>
          <div className={styles.cardValue}>{stats.readyEpisodes.toLocaleString()}</div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardLabel}>Failed Lessons</span>
          </div>
          <div className={styles.cardValue}>{stats.failedEpisodes.toLocaleString()}</div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardLabel}>Total Plays</span>
          </div>
          <div className={styles.cardValue}>{stats.totalPlays.toLocaleString()}</div>
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Signups</h2>
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Today</span>
            <span className={styles.statValue}>{stats.signupsToday.toLocaleString()}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>This Week</span>
            <span className={styles.statValue}>{stats.signupsThisWeek.toLocaleString()}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>This Month</span>
            <span className={styles.statValue}>{stats.signupsThisMonth.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Costs (30d)</h2>
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>API Costs</span>
            <span className={styles.statValue}>${stats.apiCosts.toFixed(2)}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Pipeline Success</span>
            <span className={styles.statValue}>{stats.pipelineSuccessRate}%</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>BYOK Users</span>
            <span className={styles.statValue}>{stats.byokUsers.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Duration Accuracy</h2>
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Tracked</span>
            <span className={styles.statValue}>{durationStats.tracked.toLocaleString()}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Within ±30s</span>
            <span className={styles.statValue}>{durationStats.withinTargetPct}%</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Mean Abs. Deviation</span>
            <span className={styles.statValue}>{durationStats.meanAbsDeviation}s</span>
          </div>
        </div>
      </div>

    </div>
  );
}
