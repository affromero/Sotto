import { prisma } from '@/lib/prisma';
import { getFreeTierStatus } from '@/lib/generation-gate';
import { FreeTierBanner } from '@/components/ui/FreeTierBanner';
import styles from './page.module.css';

interface DashboardStatsProps {
  userId: string;
  userEmail?: string | null;
  userRole: string;
}

export async function DashboardStats({ userId, userEmail, userRole }: DashboardStatsProps) {
  const [podcastStats, freeTier] = await Promise.all([
    prisma.podcast.aggregate({
      where: { userId },
      _count: true,
      _sum: { playCount: true },
    }),
    getFreeTierStatus(userId),
  ]);

  const hasPodcasts = podcastStats._count > 0;
  const totalListens = podcastStats._sum.playCount ?? 0;

  return (
    <>
      {userRole !== 'ADMIN' && userRole !== 'SYSTEM' && hasPodcasts && (
        <FreeTierBanner
          dailyUsed={freeTier.dailyUsed}
          dailyLimit={freeTier.dailyLimit}
          isByokUser={freeTier.isByokUser}
          isProUser={freeTier.isProUser}
          resetInSeconds={freeTier.resetInSeconds}
          email={userEmail ?? undefined}
        />
      )}

      <section className={styles.stats} aria-label="Usage statistics">
        <div className={`${styles.statCard} ${styles.statPodcasts}`}>
          <span className={styles.statLabel}>Total Podcasts</span>
          <span className={styles.statValue}>{podcastStats._count}</span>
        </div>
        <div className={`${styles.statCard} ${styles.statListens}`}>
          <span className={styles.statLabel}>Total Listens</span>
          <span className={styles.statValue}>{totalListens.toLocaleString()}</span>
        </div>
      </section>
    </>
  );
}
