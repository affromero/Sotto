import { Suspense } from 'react';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { SectionErrorBoundary } from '@/components/ui/SectionErrorBoundary';
import { DashboardStats } from './DashboardStats';
import { MyPodcastsSection } from './MyPodcastsSection';
import { TrendingToForkSection } from './TrendingToForkSection';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

function StatsSkeleton() {
  return (
    <div className={styles.stats} aria-hidden="true">
      <div className={styles.statCard} style={{ height: 80, background: 'var(--color-border)', borderRadius: 'var(--radius-xl)', animation: 'pulse 1.5s ease-in-out infinite' }} />
    </div>
  );
}

function PodcastsSkeleton() {
  return (
    <div className={styles.podcastsSection} aria-hidden="true">
      <div style={{ width: 160, height: 28, background: 'var(--color-border)', borderRadius: 'var(--radius-md)', animation: 'pulse 1.5s ease-in-out infinite' }} />
      <div className={styles.podcastGrid}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ height: 160, background: 'var(--color-border)', borderRadius: 'var(--radius-xl)', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: `${i * 100}ms` }} />
        ))}
      </div>
    </div>
  );
}

function TrendingSkeleton() {
  return (
    <div className={styles.trendingSection} aria-hidden="true">
      <div style={{ width: 200, height: 28, background: 'var(--color-border)', borderRadius: 'var(--radius-md)', animation: 'pulse 1.5s ease-in-out infinite' }} />
      <div className={styles.trendingScroll}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={styles.trendingCardWrapper} style={{ height: 180, background: 'var(--color-border)', borderRadius: 'var(--radius-xl)', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: `${i * 100}ms` }} />
        ))}
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  const userRole = ((session?.user as Record<string, unknown>)?.role as string) ?? 'USER';

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });

  const displayName = user?.name || 'there';

  return (
    <main className={styles.main}>
      <section className={styles.header}>
        <h1 className={styles.greeting}>Welcome back, {displayName}</h1>
        <Link href="/create" className={styles.createButton}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Create New Podcast
        </Link>
      </section>

      <SectionErrorBoundary sectionName="Stats">
        <Suspense fallback={<StatsSkeleton />}>
          <DashboardStats userId={userId} userEmail={session?.user?.email} userRole={userRole} />
        </Suspense>
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="My Podcasts">
        <Suspense fallback={<PodcastsSkeleton />}>
          <MyPodcastsSection userId={userId} userRole={userRole} />
        </Suspense>
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="Trending to Fork">
        <Suspense fallback={<TrendingSkeleton />}>
          <TrendingToForkSection userId={userId} />
        </Suspense>
      </SectionErrorBoundary>
    </main>
  );
}
