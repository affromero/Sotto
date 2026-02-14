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

  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  const role = dbUser?.role || 'USER';

  if (role !== 'CREATOR' && role !== 'ADMIN') {
    return (
      <main className={styles.main}>
        <div className={styles.upgradeCard}>
          <h1 className={styles.upgradeTitle}>Analytics</h1>
          <p className={styles.upgradeText}>
            Upgrade to Pro or Studio to access usage analytics, cost breakdowns, and generation
            statistics.
          </p>
          <Link href="/billing" className={styles.upgradeLink}>
            Upgrade Plan
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <AnalyticsClient />
    </main>
  );
}
