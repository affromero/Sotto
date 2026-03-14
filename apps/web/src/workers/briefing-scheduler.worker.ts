import { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { getBriefingConfig } from '@/lib/briefing-config';
import { fetchNewsletterArticles, formatArticlesForPrompt } from '@/lib/newsletter-fetcher';
import { addJob, JobType, contentExtractionQueue } from '@/lib/queue';
import { selectVoicePair } from '@/lib/elevenlabs';
import { generatePodcastSlug } from '@/lib/slugify';
import { logger } from '@/lib/logger';
import type { ScheduleBriefingsPayload } from '@/lib/queue';

export async function processBriefingScheduler(job: Job<ScheduleBriefingsPayload>): Promise<void> {
  const config = await getBriefingConfig();
  if (!config.enabled) {
    logger.info('Briefing scheduler disabled');
    await job.updateProgress(100);
    return;
  }

  const now = new Date();

  // Find eligible users: briefingEnabled, has time+timezone, not already generated today
  const eligibleUsers = await prisma.user.findMany({
    where: {
      briefingEnabled: true,
      briefingTime: { not: null },
      briefingTimezone: { not: null },
      bannedAt: null,
    },
    select: {
      id: true,
      briefingTime: true,
      briefingTimezone: true,
      briefingDays: true,
      briefingVisibility: true,
      lastBriefingAt: true,
      plan: true,
      role: true,
      interests: {
        select: { tag: { select: { slug: true, name: true } } },
      },
    },
    take: config.maxBriefingsPerBatch * 2, // over-fetch, filter in-memory
  });

  const batch: typeof eligibleUsers = [];

  for (const user of eligibleUsers) {
    if (batch.length >= config.maxBriefingsPerBatch) break;

    const tz = user.briefingTimezone!;
    const [hh, mm] = user.briefingTime!.split(':').map(Number);

    // Get current time in user's timezone
    const userNow = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const userHour = userNow.getHours();
    const userMinute = userNow.getMinutes();

    // Check if it's past the scheduled time
    if (userHour < hh || (userHour === hh && userMinute < mm)) continue;

    // Check day-of-week bitmask (Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64)
    const dayIndex = userNow.getDay(); // 0=Sun, 1=Mon
    const bitmask = dayIndex === 0 ? 64 : (1 << (dayIndex - 1));
    if ((user.briefingDays & bitmask) === 0) continue;

    // Check if already generated today (in user's TZ)
    if (user.lastBriefingAt) {
      const lastInTz = new Date(user.lastBriefingAt.toLocaleString('en-US', { timeZone: tz }));
      if (
        lastInTz.getFullYear() === userNow.getFullYear() &&
        lastInTz.getMonth() === userNow.getMonth() &&
        lastInTz.getDate() === userNow.getDate()
      ) {
        continue;
      }
    }

    batch.push(user);
  }

  if (batch.length === 0) {
    logger.info('No users eligible for briefing this cycle');
    await job.updateProgress(100);
    return;
  }

  await job.updateProgress(20);

  // Fetch recent articles (shared across all briefings this cycle)
  const allArticles = await fetchNewsletterArticles('24h');
  if (allArticles.length === 0) {
    logger.warn('No articles available for briefings, skipping cycle');
    await job.updateProgress(100);
    return;
  }

  // Get recent briefing logs for dedup
  const recentLogs = await prisma.briefingLog.findMany({
    where: {
      userId: { in: batch.map((u) => u.id) },
      generatedAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
    },
    select: { userId: true, articleIds: true },
  });
  const usedArticlesByUser = new Map<string, Set<string>>();
  for (const log of recentLogs) {
    const existing = usedArticlesByUser.get(log.userId) ?? new Set();
    for (const id of log.articleIds) existing.add(id);
    usedArticlesByUser.set(log.userId, existing);
  }

  // Resolve system user for admin credits
  const systemUser = await prisma.user.findFirst({
    where: { handle: 'sotto' },
    select: { id: true },
  });

  let generated = 0;

  for (const user of batch) {
    try {
      // Filter articles by user interests
      const interestSlugs = user.interests.map((i) => i.tag.slug);
      let userArticles = allArticles;
      if (interestSlugs.length > 0) {
        // Try to match articles to interests via IngestedArticle categories
        const matchedUrls = await prisma.ingestedArticle.findMany({
          where: {
            url: { in: allArticles.map((a) => a.url) },
            category: { in: interestSlugs },
          },
          select: { url: true },
        });
        const matchedSet = new Set(matchedUrls.map((m) => m.url));
        const matched = allArticles.filter((a) => matchedSet.has(a.url));
        // Fall back to all articles if no matches
        if (matched.length >= 3) userArticles = matched;
      }

      // Exclude recently used articles
      const usedIds = usedArticlesByUser.get(user.id);
      if (usedIds) {
        userArticles = userArticles.filter((a) => !usedIds.has(a.url));
      }

      // Select top articles (newest first, already sorted)
      const selected = userArticles.slice(0, config.maxArticlesPerBriefing);
      if (selected.length === 0) {
        logger.info('No fresh articles for user, skipping', { userId: user.id });
        continue;
      }

      const title = `Daily Briefing — ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      const topicSlugs = interestSlugs.length > 0 ? interestSlugs : ['general'];
      const sourceText = formatArticlesForPrompt(selected);

      // Select voices
      const seed = `briefing-${user.id}-${now.toISOString().slice(0, 10)}`;
      const voicePair = selectVoicePair(seed);

      const slug = await generatePodcastSlug(title, user.id, prisma);

      // Create podcast + discovery + briefing log in transaction
      const podcast = await prisma.podcast.create({
        data: {
          userId: user.id,
          title,
          slug,
          topic: `Daily briefing: ${selected.map((a) => a.title).join(', ')}`,
          status: 'EXTRACTING',
          source: 'BRIEFING',
          visibility: user.briefingVisibility,
          aiModel: config.defaultAiModel,
          ttsProvider: config.defaultTtsProvider,
          ttsModel: config.defaultTtsModel,
          voices: {
            createMany: {
              data: [
                { speaker: 'Host', voiceId: voicePair.host, provider: voicePair.provider },
                { speaker: 'Expert', voiceId: voicePair.expert, provider: voicePair.provider },
              ],
            },
          },
          discovery: {
            create: {
              topic: title,
              depth: 'quick_overview',
              audienceLevel: 'general',
              tone: 'casual',
              durationTarget: config.targetDurationMinutes,
              sourceContent: sourceText,
              userId: user.id,
            },
          },
        },
      });

      await prisma.briefingLog.create({
        data: {
          userId: user.id,
          podcastId: podcast.id,
          topicSlugs,
          articleIds: selected.map((a) => a.url),
        },
      });

      // Update lastBriefingAt
      await prisma.user.update({
        where: { id: user.id },
        data: { lastBriefingAt: now },
      });

      // Enqueue content extraction
      await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, {
        podcastId: podcast.id,
        userId: systemUser?.id ?? user.id,
        sourceText,
        useAdminCredits: true,
      });

      generated++;
      logger.info('Briefing created', { userId: user.id, podcastId: podcast.id });
    } catch (error) {
      logger.error('Failed to create briefing for user', {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('Briefing scheduler cycle complete', { generated, eligible: batch.length });
  await job.updateProgress(100);
}
