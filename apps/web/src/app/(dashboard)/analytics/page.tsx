import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AnalyticsClient } from './AnalyticsClient';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Analytics' };

export default async function AnalyticsPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    redirect('/auth/login');
  }

  const [dbUser, podcastCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    }),
    prisma.podcast.count({ where: { userId, deletedAt: null } }),
  ]);

  const role = dbUser?.role || 'USER';
  const hasAccess = podcastCount > 0 || role === 'ADMIN';

  if (!hasAccess) {
    return (
      <main className={styles.main}>
        <div className={styles.upgradeCard}>
          <h1 className={styles.upgradeTitle}>Analytics</h1>
          <p className={styles.upgradeText}>
            Analytics is available for podcast creators. Start creating podcasts to unlock
            performance analytics, audience insights, and engagement data.
          </p>
          <Link href="/create" className={styles.upgradeLink}>
            Create a Podcast
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <AnalyticsClient hasPodcasts={podcastCount > 0} />
    </main>
  );
}
