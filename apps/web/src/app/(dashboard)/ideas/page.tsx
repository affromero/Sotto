import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { IdeasList } from './IdeasList';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My Library' };

export default async function IdeasPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  const [ideas, podcastIdeas] = await Promise.all([
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
  ]);

  const serializedIdeas = ideas.map((idea) => ({
    ...idea,
    createdAt: idea.createdAt.toISOString(),
  }));

  const serializedPodcastIdeas = podcastIdeas.map((idea) => ({
    ...idea,
    createdAt: idea.createdAt.toISOString(),
  }));

  return <IdeasList ideas={serializedIdeas} podcastIdeas={serializedPodcastIdeas} />;
}
