import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { IdeasList } from './IdeasList';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Saved Ideas' };

export default async function IdeasPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  const ideas = await prisma.savedIdea.findMany({
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
  });

  const serialized = ideas.map((idea) => ({
    ...idea,
    createdAt: idea.createdAt.toISOString(),
  }));

  return <IdeasList ideas={serialized} />;
}
