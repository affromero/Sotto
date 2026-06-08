import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasByokKey } from '@/lib/byok';
import { getTierFeatures } from '@/lib/tier-features';
import { ProWaitlistButton } from '@/components/ui/ProWaitlistButton';
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

  const [dbUser, podcastCount, isByok] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, plan: true },
    }),
    prisma.podcast.count({ where: { userId, deletedAt: null } }),
    hasByokKey(userId),
  ]);

  const role = dbUser?.role || 'USER';
  const plan = (dbUser?.plan as 'FREE' | 'PRO') || 'FREE';
  const tierFeatures = getTierFeatures(plan, isByok, role);

  if (!tierFeatures.analyticsEnabled) {
    return (
      <main className={styles.main}>
        <div className={styles.upgradeCard}>
          <h1 className={styles.upgradeTitle}>Analytics</h1>
          <p className={styles.upgradeText}>
            Analytics is a Pro feature. Upgrade to Pro to unlock performance analytics, audience
            insights, and private activity.
          </p>
          <ProWaitlistButton
            email={session.user.email!}
            source="pro-analytics"
            className={styles.upgradeLink}
          />
        </div>
      </main>
    );
  }

  if (podcastCount === 0 && role !== 'ADMIN') {
    return (
      <main className={styles.main}>
        <div className={styles.upgradeCard}>
          <h1 className={styles.upgradeTitle}>Analytics</h1>
          <p className={styles.upgradeText}>
            Create your first podcast to see analytics data here.
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
