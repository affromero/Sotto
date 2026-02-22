import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { LibraryClient } from './LibraryClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My Library' };

export default async function LibraryPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  const [ideas, podcastIdeas, savedCount, collectionsCount, queueCount] = await Promise.all([
    prisma.savedIdea.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        questionId: true,
        question: true,
        tagSlugs: true,
        category: true,
        createdAt: true,
      },
    }),
    prisma.podcastIdea.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        text: true,
        sourceUrl: true,
        source: true,
        createdAt: true,
      },
    }),
    prisma.save.count({ where: { userId } }),
    prisma.collection.count({ where: { userId } }),
    prisma.listeningQueue.count({ where: { userId } }),
  ]);

  const serializedIdeas = ideas.map((idea) => ({
    ...idea,
    createdAt: idea.createdAt.toISOString(),
  }));

  const serializedPodcastIdeas = podcastIdeas.map((idea) => ({
    ...idea,
    createdAt: idea.createdAt.toISOString(),
  }));

  return (
    <LibraryClient
      ideas={serializedIdeas}
      podcastIdeas={serializedPodcastIdeas}
      counts={{
        ideas: ideas.length + podcastIdeas.length,
        saved: savedCount,
        collections: collectionsCount,
        queue: queueCount,
      }}
    />
  );
}
