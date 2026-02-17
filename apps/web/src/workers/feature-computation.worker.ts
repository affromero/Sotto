import { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getEmbeddingProvider } from '@/lib/embeddings';
import type { ComputeFeaturesPayload } from '@/lib/queue';

/**
 * Feature computation worker.
 * Aggregates PlaybackSession, BehavioralEvent, and existing models
 * into UserFeature and PodcastFeature upserts.
 * Runs hourly or on-demand.
 */
export async function processFeatureComputation(
  job: Job<ComputeFeaturesPayload>
): Promise<{ computed: string }> {
  const { scope, targetId } = job.data;

  switch (scope) {
    case 'user':
      if (targetId) {
        await computeUserFeatures(targetId);
      }
      break;
    case 'podcast':
      if (targetId) {
        await computePodcastFeatures(targetId);
      }
      break;
    case 'all':
      await computeAllFeatures(job);
      break;
  }

  await job.updateProgress(100);
  return { computed: scope };
}

async function computeAllFeatures(job: Job): Promise<void> {
  // Compute features for all users with playback sessions
  const userIds = await prisma.playbackSession.findMany({
    select: { userId: true },
    where: { userId: { not: null } },
    distinct: ['userId'],
  });

  const totalUsers = userIds.length;
  for (let i = 0; i < totalUsers; i++) {
    const userId = userIds[i].userId;
    if (userId) {
      await computeUserFeatures(userId);
    }
    await job.updateProgress(Math.round((i / (totalUsers + 1)) * 50));
  }

  // Compute features for all ready podcasts
  const podcastIds = await prisma.podcast.findMany({
    select: { id: true },
    where: { status: 'READY' },
  });

  const totalPodcasts = podcastIds.length;
  for (let i = 0; i < totalPodcasts; i++) {
    await computePodcastFeatures(podcastIds[i].id);
    await job.updateProgress(50 + Math.round((i / (totalPodcasts + 1)) * 50));
  }
}

async function computeUserFeatures(userId: string): Promise<void> {
  try {
    const sessions = await prisma.playbackSession.findMany({
      where: { userId },
      include: {
        podcast: { select: { id: true, duration: true, tags: { include: { tag: true } } } },
      },
    });

    if (sessions.length === 0) return;

    type SessionType = (typeof sessions)[0];

    const totalListenMinutes = sessions.reduce(
      (sum: number, s: SessionType) => sum + s.totalListenSeconds / 60,
      0
    );
    const completionRates = sessions
      .filter((s: SessionType) => s.completionPercent > 0)
      .map((s: SessionType) => s.completionPercent);
    const avgCompletionRate =
      completionRates.length > 0
        ? completionRates.reduce((a: number, b: number) => a + b, 0) / completionRates.length
        : 0;
    const speeds = sessions
      .filter((s: SessionType) => s.lastSpeed > 0)
      .map((s: SessionType) => s.lastSpeed);
    const avgListenSpeed =
      speeds.length > 0 ? speeds.reduce((a: number, b: number) => a + b, 0) / speeds.length : 1;

    // Abandonment metrics
    const abandonSessions = sessions.filter(
      (s: SessionType) => s.completionPercent < 95 && s.completionPercent > 0
    );
    const avgAbandonPercent =
      abandonSessions.length > 0
        ? abandonSessions.reduce((sum: number, s: SessionType) => sum + s.completionPercent, 0) /
          abandonSessions.length
        : 0;

    // Topic affinity: weight by completion rate
    const topicWeights = new Map<string, { tagId: string; tagName: string; weight: number }>();
    for (const session of sessions) {
      for (const pt of session.podcast.tags) {
        const existing = topicWeights.get(pt.tag.id);
        const weight = session.completionPercent / 100;
        if (existing) {
          existing.weight += weight;
        } else {
          topicWeights.set(pt.tag.id, { tagId: pt.tag.id, tagName: pt.tag.name, weight });
        }
      }
    }
    const topicAffinity = Array.from(topicWeights.values())
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 20);

    // Optimal duration: bucket by podcast duration, find highest avg completion
    const durationBuckets = new Map<number, number[]>();
    for (const session of sessions) {
      const durationMin = Math.round((session.podcast.duration || 0) / 60);
      const bucket = Math.round(durationMin / 5) * 5; // 5-minute buckets
      if (!durationBuckets.has(bucket)) durationBuckets.set(bucket, []);
      durationBuckets.get(bucket)!.push(session.completionPercent);
    }
    let optimalDuration = 10;
    let bestAvg = 0;
    for (const [bucket, rates] of durationBuckets) {
      const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
      if (avg > bestAvg) {
        bestAvg = avg;
        optimalDuration = bucket;
      }
    }

    // Behavioral archetype
    const archetype = classifyArchetype(avgCompletionRate, avgListenSpeed, sessions);

    // Social metrics
    const [followingCount, followerCount, likeCount, forkCount, interactionCount] =
      await Promise.all([
        prisma.follow.count({ where: { followerId: userId } }),
        prisma.follow.count({ where: { followingId: userId } }),
        prisma.like.count({ where: { userId } }),
        prisma.podcast.count({ where: { userId, forkedFromId: { not: null } } }),
        prisma.interaction.count({ where: { userId } }),
      ]);

    const totalPodcastsListened = sessions.length;
    const likeRate = totalPodcastsListened > 0 ? likeCount / totalPodcastsListened : 0;
    const forkRate = totalPodcastsListened > 0 ? forkCount / totalPodcastsListened : 0;
    const interactionRate =
      totalPodcastsListened > 0 ? interactionCount / totalPodcastsListened : 0;

    // Recency
    const lastSession = sessions.sort(
      (a: SessionType, b: SessionType) => b.startedAt.getTime() - a.startedAt.getTime()
    )[0];
    const daysSinceLastListen = lastSession
      ? (Date.now() - lastSession.startedAt.getTime()) / (1000 * 60 * 60 * 24)
      : 999;

    // Generate embedding from user's listened topics
    const topicText = topicAffinity.map((t) => t.tagName).join(' ');
    let embedding: number[] | undefined;
    if (topicText) {
      try {
        embedding = await getEmbeddingProvider().embed(topicText);
      } catch (err) {
        logger.warn('Failed to generate user embedding', { userId, error: (err as Error).message });
      }
    }

    const data = {
      totalListenMinutes,
      totalPodcastsListened,
      avgCompletionRate,
      avgListenSpeed,
      avgAbandonPercent,
      optimalDuration,
      topicAffinity,
      archetype,
      followingCount,
      followerCount,
      likeRate,
      forkRate,
      interactionRate,
      daysSinceLastListen,
      speakerPreference: 0, // Requires segment-level abandon data
      noveltyResponseRate: 0, // Requires topic diversity analysis
      creatorLoyalty: 0, // Requires follow + listen cross-reference
      listenFrequency:
        totalPodcastsListened > 0 ? totalPodcastsListened / Math.max(daysSinceLastListen, 1) : 0,
      computedAt: new Date(),
    };

    // Use raw SQL to handle pgvector embedding
    if (embedding) {
      await prisma.$executeRaw`
        INSERT INTO "UserFeature" (id, "userId", "totalListenMinutes", "totalPodcastsListened",
          "avgCompletionRate", "avgListenSpeed", "avgAbandonPercent", "optimalDuration",
          "topicAffinity", archetype, "followingCount", "followerCount", "likeRate",
          "forkRate", "interactionRate", "daysSinceLastListen", "speakerPreference",
          "noveltyResponseRate", "creatorLoyalty", "listenFrequency", embedding, "computedAt", "updatedAt")
        VALUES (gen_random_uuid(), ${userId}, ${data.totalListenMinutes}, ${data.totalPodcastsListened},
          ${data.avgCompletionRate}, ${data.avgListenSpeed}, ${data.avgAbandonPercent}, ${data.optimalDuration},
          ${JSON.stringify(data.topicAffinity)}::jsonb, ${data.archetype}, ${data.followingCount}, ${data.followerCount},
          ${data.likeRate}, ${data.forkRate}, ${data.interactionRate}, ${data.daysSinceLastListen},
          ${data.speakerPreference}, ${data.noveltyResponseRate}, ${data.creatorLoyalty},
          ${data.listenFrequency}, ${`[${embedding.join(',')}]`}::vector, NOW(), NOW())
        ON CONFLICT ("userId") DO UPDATE SET
          "totalListenMinutes" = EXCLUDED."totalListenMinutes",
          "totalPodcastsListened" = EXCLUDED."totalPodcastsListened",
          "avgCompletionRate" = EXCLUDED."avgCompletionRate",
          "avgListenSpeed" = EXCLUDED."avgListenSpeed",
          "avgAbandonPercent" = EXCLUDED."avgAbandonPercent",
          "optimalDuration" = EXCLUDED."optimalDuration",
          "topicAffinity" = EXCLUDED."topicAffinity",
          archetype = EXCLUDED.archetype,
          "followingCount" = EXCLUDED."followingCount",
          "followerCount" = EXCLUDED."followerCount",
          "likeRate" = EXCLUDED."likeRate",
          "forkRate" = EXCLUDED."forkRate",
          "interactionRate" = EXCLUDED."interactionRate",
          "daysSinceLastListen" = EXCLUDED."daysSinceLastListen",
          "speakerPreference" = EXCLUDED."speakerPreference",
          "noveltyResponseRate" = EXCLUDED."noveltyResponseRate",
          "creatorLoyalty" = EXCLUDED."creatorLoyalty",
          "listenFrequency" = EXCLUDED."listenFrequency",
          embedding = EXCLUDED.embedding,
          "computedAt" = NOW(),
          "updatedAt" = NOW()
      `;
    } else {
      await prisma.userFeature.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
    }

    logger.info('Computed user features', { userId });
  } catch (err) {
    logger.error('Failed to compute user features', { userId, error: (err as Error).message });
  }
}

async function computePodcastFeatures(podcastId: string): Promise<void> {
  try {
    const podcast = await prisma.podcast.findUnique({
      where: { id: podcastId },
      include: {
        segments: { select: { order: true, speaker: true, duration: true } },
        references: { select: { verificationStatus: true } },
      },
    });

    if (!podcast) return;

    const sessions = await prisma.playbackSession.findMany({
      where: { podcastId },
    });

    type PodcastSessionType = (typeof sessions)[0];

    if (sessions.length === 0) {
      // Create empty feature with content metrics only
      await prisma.podcastFeature.upsert({
        where: { podcastId },
        create: {
          podcastId,
          segmentCount: podcast.segments.length,
          durationSeconds: podcast.duration || 0,
          referenceCount: podcast.references.length,
          verifiedReferenceRate:
            podcast.references.length > 0
              ? podcast.references.filter((r) => r.verificationStatus === 'VERIFIED').length /
                podcast.references.length
              : 0,
        },
        update: {
          segmentCount: podcast.segments.length,
          durationSeconds: podcast.duration || 0,
          referenceCount: podcast.references.length,
          verifiedReferenceRate:
            podcast.references.length > 0
              ? podcast.references.filter((r) => r.verificationStatus === 'VERIFIED').length /
                podcast.references.length
              : 0,
          computedAt: new Date(),
        },
      });
      return;
    }

    const completionRates = sessions
      .map((s: PodcastSessionType) => s.completionPercent)
      .sort((a: number, b: number) => a - b);
    const avgCompletionRate =
      completionRates.reduce((a: number, b: number) => a + b, 0) / completionRates.length;
    const medianCompletionRate = completionRates[Math.floor(completionRates.length / 2)];
    const uniqueListeners = new Set(
      sessions.filter((s: PodcastSessionType) => s.userId).map((s: PodcastSessionType) => s.userId)
    ).size;
    const totalListenMinutes = sessions.reduce(
      (sum: number, s: PodcastSessionType) => sum + s.totalListenSeconds / 60,
      0
    );
    const speeds = sessions
      .filter((s: PodcastSessionType) => s.lastSpeed > 0)
      .map((s: PodcastSessionType) => s.lastSpeed);
    const avgListenSpeed =
      speeds.length > 0 ? speeds.reduce((a: number, b: number) => a + b, 0) / speeds.length : 1;

    // Re-listen rate
    const userSessionCounts = new Map<string, number>();
    for (const s of sessions) {
      if (s.userId) {
        userSessionCounts.set(s.userId, (userSessionCounts.get(s.userId) || 0) + 1);
      }
    }
    const usersWithMultiple = Array.from(userSessionCounts.values()).filter((c) => c > 1).length;
    const relistenRate = uniqueListeners > 0 ? usersWithMultiple / uniqueListeners : 0;

    // Engagement ratios
    const [likeCount, saveCount, forkCount, interactionCount] = await Promise.all([
      prisma.like.count({ where: { podcastId } }),
      prisma.save.count({ where: { podcastId } }),
      prisma.podcast.count({ where: { forkedFromId: podcastId } }),
      prisma.interaction.count({ where: { podcastId } }),
    ]);

    const likeToListenRatio = uniqueListeners > 0 ? likeCount / uniqueListeners : 0;
    const saveToListenRatio = uniqueListeners > 0 ? saveCount / uniqueListeners : 0;
    const forkToListenRatio = uniqueListeners > 0 ? forkCount / uniqueListeners : 0;
    const interactionRate = uniqueListeners > 0 ? interactionCount / uniqueListeners : 0;

    // Abandonment curve: bucket completionPercent by 5% increments
    const abandonmentCurve: Array<{ percentBucket: number; abandonRate: number }> = [];
    for (let bucket = 0; bucket <= 100; bucket += 5) {
      const abandonedInBucket = sessions.filter(
        (s: PodcastSessionType) =>
          s.completionPercent >= bucket &&
          s.completionPercent < bucket + 5 &&
          s.completionPercent < 95
      ).length;
      abandonmentCurve.push({
        percentBucket: bucket,
        abandonRate: sessions.length > 0 ? abandonedInBucket / sessions.length : 0,
      });
    }

    // Speed distribution
    const speedDist: Record<string, number> = {};
    for (const s of sessions) {
      const key = `${s.lastSpeed}x`;
      speedDist[key] = (speedDist[key] || 0) + 1;
    }
    const speedDistribution: Record<string, number> = {};
    for (const [key, count] of Object.entries(speedDist)) {
      speedDistribution[key] = count / sessions.length;
    }

    // Generate embedding from podcast topic + title + tags
    const tags = await prisma.podcastTag.findMany({
      where: { podcastId },
      include: { tag: true },
    });
    const embeddingText = `${podcast.title} ${podcast.topic} ${tags.map((t: { tag: { name: string } }) => t.tag.name).join(' ')}`;
    let embedding: number[] | undefined;
    try {
      embedding = await getEmbeddingProvider().embed(embeddingText);
    } catch (err) {
      logger.warn('Failed to generate podcast embedding', {
        podcastId,
        error: (err as Error).message,
      });
    }

    const data = {
      avgCompletionRate,
      medianCompletionRate,
      totalUniqueListeners: uniqueListeners,
      totalListenMinutes,
      likeToListenRatio,
      saveToListenRatio,
      forkToListenRatio,
      interactionRate,
      abandonmentCurve,
      avgListenSpeed,
      speedDistribution,
      relistenRate,
      segmentCount: podcast.segments.length,
      durationSeconds: podcast.duration || 0,
      referenceCount: podcast.references.length,
      verifiedReferenceRate:
        podcast.references.length > 0
          ? podcast.references.filter((r) => r.verificationStatus === 'VERIFIED').length /
            podcast.references.length
          : 0,
      computedAt: new Date(),
    };

    if (embedding) {
      await prisma.$executeRaw`
        INSERT INTO "PodcastFeature" (id, "podcastId", "avgCompletionRate", "medianCompletionRate",
          "totalUniqueListeners", "totalListenMinutes", "likeToListenRatio", "saveToListenRatio",
          "forkToListenRatio", "interactionRate", "abandonmentCurve", "avgListenSpeed",
          "speedDistribution", "relistenRate", "segmentCount", "durationSeconds",
          "referenceCount", "verifiedReferenceRate", embedding, "computedAt", "updatedAt")
        VALUES (gen_random_uuid(), ${podcastId}, ${data.avgCompletionRate}, ${data.medianCompletionRate},
          ${data.totalUniqueListeners}, ${data.totalListenMinutes}, ${data.likeToListenRatio},
          ${data.saveToListenRatio}, ${data.forkToListenRatio}, ${data.interactionRate},
          ${JSON.stringify(data.abandonmentCurve)}::jsonb, ${data.avgListenSpeed},
          ${JSON.stringify(data.speedDistribution)}::jsonb, ${data.relistenRate},
          ${data.segmentCount}, ${data.durationSeconds}, ${data.referenceCount},
          ${data.verifiedReferenceRate}, ${`[${embedding.join(',')}]`}::vector, NOW(), NOW())
        ON CONFLICT ("podcastId") DO UPDATE SET
          "avgCompletionRate" = EXCLUDED."avgCompletionRate",
          "medianCompletionRate" = EXCLUDED."medianCompletionRate",
          "totalUniqueListeners" = EXCLUDED."totalUniqueListeners",
          "totalListenMinutes" = EXCLUDED."totalListenMinutes",
          "likeToListenRatio" = EXCLUDED."likeToListenRatio",
          "saveToListenRatio" = EXCLUDED."saveToListenRatio",
          "forkToListenRatio" = EXCLUDED."forkToListenRatio",
          "interactionRate" = EXCLUDED."interactionRate",
          "abandonmentCurve" = EXCLUDED."abandonmentCurve",
          "avgListenSpeed" = EXCLUDED."avgListenSpeed",
          "speedDistribution" = EXCLUDED."speedDistribution",
          "relistenRate" = EXCLUDED."relistenRate",
          "segmentCount" = EXCLUDED."segmentCount",
          "durationSeconds" = EXCLUDED."durationSeconds",
          "referenceCount" = EXCLUDED."referenceCount",
          "verifiedReferenceRate" = EXCLUDED."verifiedReferenceRate",
          embedding = EXCLUDED.embedding,
          "computedAt" = NOW(),
          "updatedAt" = NOW()
      `;
    } else {
      await prisma.podcastFeature.upsert({
        where: { podcastId },
        create: { podcastId, ...data },
        update: data,
      });
    }

    logger.info('Computed podcast features', { podcastId });
  } catch (err) {
    logger.error('Failed to compute podcast features', {
      podcastId,
      error: (err as Error).message,
    });
  }
}

function classifyArchetype(
  avgCompletion: number,
  avgSpeed: number,
  sessions: Array<{ seekCount: number; interruptCount: number }>
): string {
  const avgSeeks = sessions.reduce((sum, s) => sum + s.seekCount, 0) / sessions.length;
  const avgInteractions = sessions.reduce((sum, s) => sum + s.interruptCount, 0) / sessions.length;

  if (avgCompletion > 90 && avgSpeed <= 1.25) return 'deep_listener';
  if (avgCompletion < 50 && avgSpeed > 1.25 && avgSeeks > 2) return 'skimmer';
  if (avgCompletion > 90 && avgInteractions < 0.5) return 'completer';
  if (avgInteractions > 1) return 'social_learner';
  return 'explorer';
}
