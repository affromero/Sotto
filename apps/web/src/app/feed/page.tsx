import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import type { Metadata } from 'next';
import { TopBar } from '@/components/layout/TopBar';
import { FeedClient } from './FeedClient';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Discover Podcasts',
  description: 'Explore AI-generated podcasts created by the Sotto community.',
};

const podcastSelect = {
  id: true,
  title: true,
  topic: true,
  status: true,
  visibility: true,
  audioUrl: true,
  duration: true,
  playCount: true,
  likeCount: true,
  forkCount: true,
  createdAt: true,
  source: true,
  sourcePlatform: true,
  isHumanContent: true,
  aiProvider: true,
  aiModel: true,
  ttsProvider: true,
  ttsModel: true,
  language: true,
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
} as const;

export default async function FeedPage() {
  const session = await auth();
  const isAuthenticated = !!session?.user?.id;

  const [podcasts, tags, trending] = await Promise.all([
    prisma.podcast.findMany({
      where: {
        status: 'READY',
        visibility: 'PUBLIC',
      },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: podcastSelect,
    }),
    prisma.tag.findMany({
      orderBy: { name: 'asc' },
      take: 20,
      select: {
        id: true,
        name: true,
        slug: true,
      },
    }),
    prisma.podcast.findMany({
      where: {
        status: 'READY',
        visibility: 'PUBLIC',
      },
      orderBy: { playCount: 'desc' },
      take: 8,
      select: podcastSelect,
    }),
  ]);

  const serializePodcasts = (list: typeof podcasts) =>
    list.map((p) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
      tags: p.tags.map((pt) => pt.tag),
    }));

  const serializedAll = serializePodcasts(podcasts);
  const serializedTrending = serializePodcasts(trending);

  // Only show hero when there are enough podcasts to justify featuring some
  const hasEnoughForHero = serializedAll.length >= 6;
  const heroPodcasts = hasEnoughForHero ? serializedTrending.slice(0, 3) : [];
  const remainingTrending = hasEnoughForHero ? serializedTrending.slice(3) : serializedTrending;

  // Exclude hero podcasts from the main grid to avoid duplication
  const heroIds = new Set(heroPodcasts.map((p) => p.id));
  const gridPodcasts = serializedAll.filter((p) => !heroIds.has(p.id));

  const topBarUser = session?.user
    ? { name: session.user.name, image: session.user.image, id: session.user.id }
    : null;

  return (
    <>
      <TopBar user={topBarUser} />
      <main className={styles.main}>
        <div className={styles.container}>
          <FeedClient
            initialPodcasts={gridPodcasts}
            heroPodcasts={heroPodcasts}
            trendingPodcasts={remainingTrending}
            tags={tags}
            isAuthenticated={isAuthenticated}
            currentUserId={session?.user?.id ?? null}
          />
        </div>
      </main>
    </>
  );
}
