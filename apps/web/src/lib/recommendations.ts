import { prisma } from './prisma';
import { createMLProvider } from './providers/ml';
import { logger } from './logger';

/**
 * Search for similar existing podcasts in the signed-in user's library.
 * Uses pgvector embedding similarity when available, then narrows to owned podcasts.
 */
export async function findSimilarPodcasts(params: {
  topic: string;
  userId: string;
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
          userId: params.userId,
          status: 'READY',
          deletedAt: null,
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
    logger.warn('Embedding similarity search unavailable; using private text search', {
      error: (err as Error).message,
    });
  }

  // Text search when vector search is unavailable.
  const podcasts = await prisma.podcast.findMany({
    where: {
      userId: params.userId,
      status: 'READY',
      deletedAt: null,
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
