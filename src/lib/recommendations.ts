import { prisma } from './prisma';
import { logger } from './logger';

/**
 * Search for similar existing public podcasts based on topic
 * Uses PostgreSQL full-text search for MVP
 */
export async function findSimilarPodcasts(params: {
  topic: string;
  excludeUserId?: string;
  limit?: number;
}): Promise<
  Array<{
    id: string;
    title: string;
    topic: string;
    playCount: number;
    likeCount: number;
    duration: number | null;
    user: { id: string; name: string | null; image: string | null };
  }>
> {
  const searchTerms = params.topic
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .slice(0, 10)
    .join(' | ');

  if (!searchTerms) return [];

  const podcasts = await prisma.podcast.findMany({
    where: {
      status: 'READY',
      visibility: 'PUBLIC',
      ...(params.excludeUserId && { userId: { not: params.excludeUserId } }),
      OR: [
        { title: { contains: params.topic, mode: 'insensitive' } },
        { topic: { contains: params.topic, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      title: true,
      topic: true,
      playCount: true,
      likeCount: true,
      duration: true,
      user: {
        select: { id: true, name: true, image: true },
      },
    },
    orderBy: [{ playCount: 'desc' }, { likeCount: 'desc' }],
    take: params.limit || 5,
  });

  logger.info('Similar podcasts found', { topic: params.topic, count: String(podcasts.length) });
  return podcasts;
}
