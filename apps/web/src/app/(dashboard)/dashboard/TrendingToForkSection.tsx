import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { PodcastCard } from '@/components/feed/PodcastCard';
import styles from './page.module.css';

interface TrendingToForkSectionProps {
  userId: string;
}

export async function TrendingToForkSection({ userId }: TrendingToForkSectionProps) {
  const trendingToFork = await prisma.podcast.findMany({
    where: {
      status: 'READY',
      visibility: 'PUBLIC',
      userId: { not: userId },
    },
    orderBy: { forkCount: 'desc' },
    take: 6,
    select: {
      id: true,
      slug: true,
      title: true,
      topic: true,
      status: true,
      visibility: true,
      audioUrl: true,
      duration: true,
      playCount: true,
      forkCount: true,
      likeCount: true,
      createdAt: true,
      source: true,
      sourcePlatform: true,
      isHumanContent: true,
      forkedFromId: true,
      user: {
        select: {
          id: true,
          name: true,
          image: true,
          handle: true,
          role: true,
        },
      },
      tags: {
        include: {
          tag: {
            select: { id: true, name: true, slug: true },
          },
        },
      },
    },
  });

  if (trendingToFork.length === 0) {
    return null;
  }

  const serialized = trendingToFork.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    tags: p.tags.map((pt) => pt.tag),
    ownerIsPro: false,
  }));

  return (
    <section className={styles.trendingSection} aria-label="Trending podcasts to fork">
      <div className={styles.trendingSectionHeader}>
        <h2 className={styles.sectionTitle}>Trending to Fork</h2>
        <Link href="/feed?sort=most_forked" className={styles.seeAllLink}>
          See all
        </Link>
      </div>
      <div className={styles.trendingScroll}>
        {serialized.map((p) => (
          <div key={p.id} className={styles.trendingCardWrapper}>
            <PodcastCard podcast={p} variant="compact" />
          </div>
        ))}
      </div>
    </section>
  );
}
