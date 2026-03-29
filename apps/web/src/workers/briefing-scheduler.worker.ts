import { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import {
  getBriefingConfig,
  resolveBriefingConfig,
  fetchAndFilterArticles,
  createBriefingPodcast,
  type BriefingWithUser,
} from '@/lib/briefing-generator';
import { logger } from '@/lib/logger';
import type { ScheduleBriefingsPayload } from '@/lib/queue';

/**
 * Query eligible briefings using pre-computed nextRunAt.
 * No timezone math in Node — the DB index on (enabled, nextRunAt) does the work.
 */
async function queryEligibleBriefings(batchSize: number, now: Date) {
  return prisma.userBriefing.findMany({
    where: {
      enabled: true,
      nextRunAt: { lte: now },
      user: { bannedAt: null },
    },
    include: {
      user: {
        select: {
          id: true,
          preferredAiModel: true,
          preferredTtsProvider: true,
          preferredTtsModel: true,
          bannedAt: true,
          interests: {
            select: { tag: { select: { slug: true } } },
          },
        },
      },
    },
    orderBy: { nextRunAt: 'asc' },
    take: batchSize,
  });
}

export async function processBriefingScheduler(job: Job<ScheduleBriefingsPayload>): Promise<void> {
  const config = await getBriefingConfig();
  if (!config.enabled) {
    logger.info('Briefing scheduler disabled');
    await job.updateProgress(100);
    return;
  }

  const now = new Date();
  const briefings = await queryEligibleBriefings(config.maxBriefingsPerBatch, now);

  if (briefings.length === 0) {
    logger.info('No briefings eligible this cycle');
    await job.updateProgress(100);
    return;
  }

  await job.updateProgress(20);

  // Prefetch article category map once for the batch (fix N+1)
  const allInterestSlugs = new Set<string>();
  for (const b of briefings) {
    for (const i of b.user.interests) allInterestSlugs.add(i.tag.slug);
  }

  let generated = 0;
  const scheduledDate = now.toISOString().slice(0, 10);

  for (const briefing of briefings) {
    try {
      // Idempotency: check unique constraint before doing expensive work
      const existing = await prisma.briefingLog.findUnique({
        where: {
          userBriefingId_scheduledDate: {
            userBriefingId: briefing.id,
            scheduledDate,
          },
        },
        select: { id: true },
      });

      if (existing) {
        logger.info('Briefing already generated today, skipping', { briefingId: briefing.id });
        continue;
      }

      const resolved = resolveBriefingConfig(briefing, briefing.user, config);
      const interestSlugs = briefing.user.interests.map((i) => i.tag.slug);

      const articles = await fetchAndFilterArticles(briefing.id, interestSlugs, config);
      if (articles.length === 0) {
        logger.info('No fresh articles for briefing, skipping', { briefingId: briefing.id });
        continue;
      }

      await createBriefingPodcast(briefing as BriefingWithUser, resolved, articles);
      generated++;
    } catch (error) {
      // Handle unique constraint race gracefully
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        logger.info('Briefing hit unique constraint (race), skipping', { briefingId: briefing.id });
        continue;
      }
      logger.error('Failed to create briefing', {
        briefingId: briefing.id,
        userId: briefing.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('Briefing scheduler cycle complete', { generated, eligible: briefings.length });
  await job.updateProgress(100);
}
