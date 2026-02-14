import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import type { Metadata } from 'next';
import { FeedClient } from './FeedClient';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Discover Podcasts',
  description: 'Explore AI-generated podcasts created by the Sotto community.',
};

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
      select: {
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
        isHumanContent: true,
        forkedFromId: true,
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            handle: true,
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
      select: {
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
        isHumanContent: true,
        forkedFromId: true,
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            handle: true,
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
    }),
  ]);

  const serializePodcasts = (list: typeof podcasts) =>
    list.map((p) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
      tags: p.tags.map((pt) => pt.tag),
    }));

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Discover Podcasts</h1>
          <p className={styles.subtitle}>
            Explore AI-generated podcasts created by the community. Learn something new today.
          </p>
        </header>

        <FeedClient
          initialPodcasts={serializePodcasts(podcasts)}
          trendingPodcasts={serializePodcasts(trending)}
          tags={tags}
          isAuthenticated={isAuthenticated}
        />
      </div>
    </main>
  );
}
