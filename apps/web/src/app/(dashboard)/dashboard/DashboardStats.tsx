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
  const [podcastStats, freeTier, user] = await Promise.all([
    prisma.podcast.aggregate({
      where: { userId },
      _count: true,
      _sum: { playCount: true, forkCount: true, likeCount: true },
    }),
    getFreeTierStatus(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        _count: { select: { followers: true } },
      },
    }),
  ]);

  const isCreatorOrAdmin = userRole === 'CREATOR' || userRole === 'ADMIN';
  const totalListens = podcastStats._sum.playCount ?? 0;
  const totalForks = podcastStats._sum.forkCount ?? 0;
  const totalLikes = podcastStats._sum.likeCount ?? 0;
  const followerCount = user?._count?.followers ?? 0;

  return (
    <>
      {userRole !== 'ADMIN' && userRole !== 'SYSTEM' && (
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
      </section>

      {isCreatorOrAdmin && (
        <section className={styles.creatorStats} aria-label="Creator statistics">
          <h2 className={styles.creatorStatsTitle}>Creator Stats</h2>
          <div className={styles.creatorStatsGrid}>
            <div className={`${styles.creatorStatCard} ${styles.statListens}`}>
              <span className={styles.statLabel}>Total Listens</span>
              <span className={styles.statValue}>{totalListens.toLocaleString()}</span>
            </div>
            <div className={`${styles.creatorStatCard} ${styles.statFollowers}`}>
              <span className={styles.statLabel}>Followers</span>
              <span className={styles.statValue}>{followerCount.toLocaleString()}</span>
            </div>
            <div className={`${styles.creatorStatCard} ${styles.statForks}`}>
              <span className={styles.statLabel}>Forks</span>
              <span className={styles.statValue}>{totalForks.toLocaleString()}</span>
            </div>
            <div className={`${styles.creatorStatCard} ${styles.statLikes}`}>
              <span className={styles.statLabel}>Likes</span>
              <span className={styles.statValue}>{totalLikes.toLocaleString()}</span>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
