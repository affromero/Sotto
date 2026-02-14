import { prisma } from '@/lib/prisma';
import styles from './page.module.css';

async function getOverviewStats() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today);
  monthAgo.setDate(monthAgo.getDate() - 30);

  const [
    totalUsers,
    totalPodcasts,
    waitlistSize,
    readyPodcasts,
    failedPodcasts,
    signupsToday,
    signupsThisWeek,
    signupsThisMonth,
    totalPlays,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.podcast.count(),
    prisma.waitlist.count(),
    prisma.podcast.count({ where: { status: 'READY' } }),
    prisma.podcast.count({ where: { status: 'FAILED' } }),
    prisma.user.count({
      where: { createdAt: { gte: today } },
    }),
    prisma.user.count({
      where: { createdAt: { gte: weekAgo } },
    }),
    prisma.user.count({
      where: { createdAt: { gte: monthAgo } },
    }),
    prisma.podcast.aggregate({
      _sum: { playCount: true },
    }),
  ]);

  return {
    totalUsers,
    totalPodcasts,
    waitlistSize,
    readyPodcasts,
    failedPodcasts,
    signupsToday,
    signupsThisWeek,
    signupsThisMonth,
    totalPlays: totalPlays._sum.playCount ?? 0,
  };
}

export default async function AdminOverviewPage() {
  const stats = await getOverviewStats();

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
            <span className={styles.cardLabel}>Total Podcasts</span>
          </div>
          <div className={styles.cardValue}>{stats.totalPodcasts.toLocaleString()}</div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardLabel}>Waitlist</span>
          </div>
          <div className={styles.cardValue}>{stats.waitlistSize.toLocaleString()}</div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardLabel}>Ready Podcasts</span>
          </div>
          <div className={styles.cardValue}>{stats.readyPodcasts.toLocaleString()}</div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardLabel}>Failed Podcasts</span>
          </div>
          <div className={styles.cardValue}>{stats.failedPodcasts.toLocaleString()}</div>
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

    </div>
  );
}
