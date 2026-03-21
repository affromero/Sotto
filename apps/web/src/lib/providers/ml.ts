import { Prisma } from '@prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { getEmbeddingProvider } from '@/lib/embeddings';
import { logger } from '@/lib/logger';
import {
  computeRelevance,
  computeCollaborative,
  computeQuality,
  computeFreshness,
  computeNovelty,
  computeWeightedScore,
  getArchetypeWeights,
  explain,
} from '@sottofm/feed';
import type { RecommendationSignals } from '@sottofm/feed';

// Re-export for downstream compatibility
export type { RecommendationSignals } from '@sottofm/feed';

export interface ScoredPodcast {
  podcastId: string;
  score: number;
  signals: RecommendationSignals;
  explanation: string;
}

export interface MLProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  findSimilarByVector(
    embedding: number[],
    limit: number,
    excludeIds?: string[]
  ): Promise<Array<{ podcastId: string; similarity: number }>>;
  computeScore(userId: string, podcastId: string): Promise<ScoredPodcast>;
  explain(signals: RecommendationSignals): string;
}

/**
 * Sotto ML Provider implementation.
 * Uses pgvector for vector ops, Prisma for feature lookups.
 * Delegates signal computation to @sottofm/feed.
 */
export class SottoMLProvider implements MLProvider {
  async embed(text: string): Promise<number[]> {
    return getEmbeddingProvider().embed(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return getEmbeddingProvider().embedBatch(texts);
  }

  async findSimilarByVector(
    embedding: number[],
    limit: number,
    excludeIds: string[] = []
  ): Promise<Array<{ podcastId: string; similarity: number }>> {
    const vectorStr = `[${embedding.join(',')}]`;
    const excludeClause =
      excludeIds.length > 0
        ? Prisma.sql`AND "podcastId" NOT IN (${Prisma.join(excludeIds)})`
        : Prisma.empty;

    const results = await prisma.$queryRaw<Array<{ podcastId: string; similarity: number }>>`
      SELECT "podcastId", 1 - (embedding <=> ${vectorStr}::vector) as similarity
      FROM "PodcastFeature"
      WHERE embedding IS NOT NULL ${excludeClause}
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${limit}`;

    return results;
  }

  async computeScore(userId: string, podcastId: string): Promise<ScoredPodcast> {
    const [userFeature, podcastFeature, podcast, userInterests, podcastTags] = await Promise.all([
      prisma.userFeature.findUnique({ where: { userId } }),
      prisma.podcastFeature.findUnique({ where: { podcastId } }),
      prisma.podcast.findUnique({
        where: { id: podcastId },
        select: {
          id: true,
          title: true,
          topic: true,
          createdAt: true,
          userId: true,
          playCount: true,
        },
      }),
      prisma.userInterest.findMany({
        where: { userId },
        select: { tagId: true, weight: true },
      }),
      prisma.podcastTag.findMany({
        where: { podcastId },
        select: { tagId: true },
      }),
    ]);

    if (!podcast) {
      return {
        podcastId,
        score: 0,
        signals: { relevance: 0, collaborative: 0, quality: 0, freshness: 0, novelty: 0 },
        explanation: '',
      };
    }

    // Fetch embedding similarity via pgvector
    let embeddingSimilarity = 0;
    if (userFeature && podcastFeature) {
      try {
        const result = await prisma.$queryRawUnsafe<Array<{ similarity: number }>>(
          `SELECT 1 - (
            (SELECT embedding FROM "UserFeature" WHERE "userId" = $1) <=>
            (SELECT embedding FROM "PodcastFeature" WHERE "podcastId" = $2)
          ) as similarity`,
          userId,
          podcastId
        );
        embeddingSimilarity = result[0]?.similarity ?? 0;
      } catch {
        embeddingSimilarity = 0.3;
      }
    }

    // Fetch tag parent map for sibling matching
    let tagParentMap = new Map<string, string | null>();
    if (userInterests.length > 0 && podcastTags.length > 0) {
      const allTagIds = [
        ...userInterests.map((i) => i.tagId),
        ...podcastTags.map((t) => t.tagId),
      ];
      const tagParents = await prisma.tag.findMany({
        where: { id: { in: allTagIds } },
        select: { id: true, parentId: true },
      });
      tagParentMap = new Map(tagParents.map((t) => [t.id, t.parentId]));
    }

    // Fetch collaborative data
    let completionRates: number[] = [];
    try {
      const similarUserSessions = await prisma.playbackSession.findMany({
        where: {
          podcastId,
          userId: { not: userId },
          completionPercent: { gte: 50 },
        },
        select: { completionPercent: true },
        take: 100,
      });
      completionRates = similarUserSessions.map((s) => s.completionPercent);
    } catch {
      // No collaborative data
    }

    // Compute signals via @sottofm/feed
    const relevance = computeRelevance({
      embeddingSimilarity,
      interestMatches: userInterests.map((i) => ({ tagId: i.tagId, weight: i.weight })),
      podcastTagIds: podcastTags.map((t) => t.tagId),
      tagParentMap,
    });

    const collaborative = computeCollaborative({ completionRates });

    const quality = podcastFeature
      ? computeQuality({
          avgCompletionRate: podcastFeature.avgCompletionRate,
          likeToListenRatio: podcastFeature.likeToListenRatio,
          verifiedReferenceRate: podcastFeature.verifiedReferenceRate,
          interactionRate: podcastFeature.interactionRate,
        })
      : 0;

    const freshness = computeFreshness({
      createdAt: podcast.createdAt,
      totalUniqueListeners: podcastFeature?.totalUniqueListeners ?? 0,
    });

    const novelty = computeNovelty({
      relevanceScore: relevance,
      hasTopicAffinity: !!userFeature?.topicAffinity,
    });

    const signals: RecommendationSignals = {
      relevance,
      collaborative,
      quality,
      freshness,
      novelty,
    };

    const weights = getArchetypeWeights(userFeature?.archetype ?? 'explorer');
    const score = computeWeightedScore(signals, weights);
    const explanation = this.explain(signals);

    return { podcastId, score, signals, explanation };
  }

  explain(signals: RecommendationSignals): string {
    return explain(signals);
  }
}

let _mlProvider: MLProvider | null = null;

export function createMLProvider(): MLProvider {
  if (!_mlProvider) {
    _mlProvider = new SottoMLProvider();
    logger.info('ML provider initialized');
  }
  return _mlProvider;
}
