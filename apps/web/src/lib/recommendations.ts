import { prisma } from './prisma';
import { createMLProvider } from './providers/ml';
import { logger } from './logger';

/**
 * Search for similar existing public podcasts based on topic.
 * Uses pgvector embedding similarity when available, falls back to text search.
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
    duration: number | null;
    user: { id: string; name: string | null; image: string | null };
  }>
> {
  const limit = params.limit || 5;

  // Try embedding-based similarity first
  try {
    const ml = createMLProvider();
    const embedding = await ml.embed(params.topic);
    const similar = await ml.findSimilarByVector(embedding, limit * 2);

    if (similar.length > 0) {
      const podcastIds = similar.map((s) => s.podcastId);
      const podcasts = await prisma.podcast.findMany({
        where: {
          id: { in: podcastIds },
          status: 'READY',
          visibility: 'PUBLIC',
          ...(params.excludeUserId && { userId: { not: params.excludeUserId } }),
        },
        select: {
          id: true,
          title: true,
          topic: true,
          playCount: true,
          duration: true,
          user: { select: { id: true, name: true, image: true } },
        },
        take: limit,
      });

      // Preserve similarity ordering
      const orderMap = new Map(similar.map((s, i) => [s.podcastId, i]));
      podcasts.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));

      if (podcasts.length > 0) {
        logger.info('Found similar podcasts via embedding', {
          topic: params.topic,
          count: String(podcasts.length),
        });
        return podcasts;
      }
    }
  } catch (err) {
    logger.warn('Embedding similarity search failed, falling back to text', {
      error: (err as Error).message,
    });
  }

  // Fallback: text search
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
      duration: true,
      user: {
        select: { id: true, name: true, image: true },
      },
    },
    orderBy: [{ playCount: 'desc' }, { saveCount: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });

  logger.info('Similar podcasts found via text search', {
    topic: params.topic,
    count: String(podcasts.length),
  });
  return podcasts;
}
