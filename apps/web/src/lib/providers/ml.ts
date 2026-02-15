import { prisma } from '@/lib/prisma';
import { getEmbeddingProvider } from '@/lib/embeddings';
import { logger } from '@/lib/logger';

export interface RecommendationSignals {
  relevance: number;
  collaborative: number;
  quality: number;
  freshness: number;
  novelty: number;
}

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
        ? `AND "podcastId" NOT IN (${excludeIds.map((id) => `'${id}'`).join(',')})`
        : '';

    const results = await prisma.$queryRawUnsafe<Array<{ podcastId: string; similarity: number }>>(
      `SELECT "podcastId", 1 - (embedding <=> $1::vector) as similarity
       FROM "PodcastFeature"
       WHERE embedding IS NOT NULL ${excludeClause}
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      vectorStr,
      limit
    );

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

    // Signal 1: Semantic Relevance (0-1)
    let relevance = 0;
    if (userFeature && podcastFeature) {
      // Use pgvector similarity if embeddings exist
      try {
        const result = await prisma.$queryRawUnsafe<Array<{ similarity: number }>>(
          `SELECT 1 - (
            (SELECT embedding FROM "UserFeature" WHERE "userId" = $1) <=>
            (SELECT embedding FROM "PodcastFeature" WHERE "podcastId" = $2)
          ) as similarity`,
          userId,
          podcastId
        );
        relevance = result[0]?.similarity ?? 0;
      } catch {
        relevance = 0.3; // Fallback
      }
    }

    // Boost relevance with explicit UserInterest matches (hierarchical)
    // Exact sub-tag match = full weight, sibling match (same parent) = 0.4 weight
    if (userInterests.length > 0 && podcastTags.length > 0) {
      // Look up parentIds for all relevant tags to enable sibling matching
      const allTagIds = [
        ...userInterests.map((i) => i.tagId),
        ...podcastTags.map((t) => t.tagId),
      ];
      const tagParents = await prisma.tag.findMany({
        where: { id: { in: allTagIds } },
        select: { id: true, parentId: true },
      });
      const parentMap = new Map(tagParents.map((t) => [t.id, t.parentId]));

      const interestMap = new Map(userInterests.map((i) => [i.tagId, i.weight]));
      const podcastTagIds = new Set(podcastTags.map((t) => t.tagId));
      let matchWeight = 0;
      let totalWeight = 0;
      for (const [tagId, weight] of interestMap) {
        totalWeight += Math.abs(weight);
        if (podcastTagIds.has(tagId)) {
          // Exact match: full weight
          matchWeight += weight;
        } else {
          // Sibling match: same parent → 0.4 weight
          const interestParent = parentMap.get(tagId);
          if (interestParent) {
            const hasSibling = podcastTags.some((t) => {
              const podcastTagParent = parentMap.get(t.tagId);
              return podcastTagParent === interestParent;
            });
            if (hasSibling) {
              matchWeight += weight * 0.4;
            }
          }
        }
      }
      if (totalWeight > 0) {
        const interestRelevance = matchWeight / totalWeight;
        // Blend: explicit interests (stronger prior) with embedding similarity
        relevance = Math.min(relevance * 0.5 + interestRelevance * 0.5, 1);
      }
    }

    // Signal 2: Collaborative Filtering (0-1)
    let collaborative = 0;
    try {
      // Find similar users (same archetype, similar completion rates) and check if they completed this podcast
      const similarUserSessions = await prisma.playbackSession.findMany({
        where: {
          podcastId,
          userId: { not: userId },
          completionPercent: { gte: 50 },
        },
        select: { completionPercent: true },
        take: 100,
      });
      if (similarUserSessions.length > 0) {
        collaborative = Math.min(
          similarUserSessions.reduce(
            (sum: number, s: { completionPercent: number }) => sum + s.completionPercent / 100,
            0
          ) / similarUserSessions.length,
          1
        );
      }
    } catch {
      collaborative = 0;
    }

    // Signal 3: Quality Score (0-1)
    let quality = 0;
    if (podcastFeature) {
      quality = Math.min(
        (podcastFeature.avgCompletionRate / 100) * 0.4 +
          podcastFeature.likeToListenRatio * 0.3 +
          podcastFeature.verifiedReferenceRate * 0.2 +
          podcastFeature.interactionRate * 0.1,
        1
      );
    }

    // Signal 4: Freshness + Discovery Bonus (0-1)
    const ageHours = (Date.now() - podcast.createdAt.getTime()) / (1000 * 60 * 60);
    const timeFreshness = Math.max(0, 1 - ageHours / (30 * 24)); // Decay over 30 days
    const coldStartBonus = (podcastFeature?.totalUniqueListeners ?? 0) < 10 ? 0.2 : 0;
    const freshness = Math.min(timeFreshness + coldStartBonus, 1);

    // Signal 5: Novelty / Anti-Echo-Chamber (0-1)
    let novelty = 0.5; // Default: moderate novelty
    if (userFeature?.topicAffinity) {
      // If user has strong topic affinity, give higher novelty score to dissimilar podcasts
      novelty = Math.max(0, 1 - relevance); // Inverse of relevance = novelty
    }

    const signals: RecommendationSignals = {
      relevance,
      collaborative,
      quality,
      freshness,
      novelty,
    };

    // Get per-user weight adaptation based on archetype
    const weights = getArchetypeWeights(userFeature?.archetype ?? 'explorer');

    const score =
      signals.relevance * weights.relevance +
      signals.collaborative * weights.collaborative +
      signals.quality * weights.quality +
      signals.freshness * weights.freshness +
      signals.novelty * weights.novelty;

    const explanation = this.explain(signals);

    return { podcastId, score, signals, explanation };
  }

  explain(signals: RecommendationSignals): string {
    const dominant = Object.entries(signals).sort(([, a], [, b]) => b - a)[0][0];

    switch (dominant) {
      case 'relevance':
        return 'Matches your listening history and interests';
      case 'collaborative':
        return 'Highly rated by listeners with similar taste';
      case 'quality':
        return 'Outstanding engagement and verified sources';
      case 'freshness':
        return 'Recently published and gaining traction';
      case 'novelty':
        return 'Something different — explore a new perspective';
      default:
        return 'Recommended for you';
    }
  }
}

function getArchetypeWeights(archetype: string): Record<string, number> {
  switch (archetype) {
    case 'deep_listener':
      return { relevance: 0.35, quality: 0.3, collaborative: 0.2, novelty: 0.1, freshness: 0.05 };
    case 'skimmer':
      return { quality: 0.3, freshness: 0.25, relevance: 0.2, novelty: 0.15, collaborative: 0.1 };
    case 'explorer':
      return { novelty: 0.3, freshness: 0.25, quality: 0.2, collaborative: 0.15, relevance: 0.1 };
    case 'completer':
      return { relevance: 0.3, collaborative: 0.25, quality: 0.25, freshness: 0.15, novelty: 0.05 };
    case 'social_learner':
      return { collaborative: 0.35, quality: 0.25, relevance: 0.2, freshness: 0.1, novelty: 0.1 };
    default:
      return { relevance: 0.3, collaborative: 0.25, quality: 0.2, freshness: 0.15, novelty: 0.1 };
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
