import { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { getBriefingConfig, type BriefingConfigData } from '@/lib/briefing-config';
import { fetchNewsletterArticles, formatArticlesForPrompt } from '@/lib/newsletter-fetcher';
import { addJob, JobType, contentExtractionQueue } from '@/lib/queue';
import { selectVoicePair, resolveVoiceId, VOICE_POOL, type VoicePoolEntry } from '@/lib/voice-pool';
import { generatePodcastSlug } from '@/lib/slugify';
import { hasByokKey, hasAiKey } from '@/lib/byok';
import { logger } from '@/lib/logger';
import type { ScheduleBriefingsPayload } from '@/lib/queue';

/** Fields queried per eligible user. */
type BriefingUser = Awaited<ReturnType<typeof queryEligibleUsers>>[number];

async function queryEligibleUsers(config: BriefingConfigData) {
  return prisma.user.findMany({
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
      // User general preferences (fallback tier)
      preferredAiModel: true,
      preferredTtsProvider: true,
      preferredTtsModel: true,
      // Briefing-specific overrides (top tier)
      briefingAiModel: true,
      briefingTtsProvider: true,
      briefingTtsModel: true,
      briefingHostVoiceId: true,
      briefingExpertVoiceId: true,
      briefingDepth: true,
      briefingTone: true,
      briefingAudienceLevel: true,
      briefingDuration: true,
      briefingPrompt: true,
      briefingUseByokKeys: true,
    },
    take: config.maxBriefingsPerBatch * 2,
  });
}

/**
 * Resolve briefing config for a user using 3-tier fallback:
 * 1. User's briefing-specific override
 * 2. User's general preference
 * 3. Admin BriefingConfig default
 */
function resolveBriefingConfig(user: BriefingUser, adminConfig: BriefingConfigData) {
  return {
    aiModel: user.briefingAiModel ?? user.preferredAiModel ?? adminConfig.defaultAiModel,
    ttsProvider: user.briefingTtsProvider ?? user.preferredTtsProvider ?? adminConfig.defaultTtsProvider,
    ttsModel: user.briefingTtsModel ?? user.preferredTtsModel ?? adminConfig.defaultTtsModel,
    depth: user.briefingDepth ?? 'quick_overview',
    tone: user.briefingTone ?? 'casual',
    audienceLevel: user.briefingAudienceLevel ?? 'general',
    durationTarget: user.briefingDuration ?? adminConfig.targetDurationMinutes,
    prompt: user.briefingPrompt,
    useByokKeys: user.briefingUseByokKeys,
  };
}

/**
 * Resolve voice IDs for a user's briefing.
 * If the user specified voice pool names, look them up and resolve for the target provider.
 * Otherwise, use selectVoicePair with tone/audience metadata for smart matching.
 */
function resolveVoices(
  user: BriefingUser,
  ttsProvider: string | null,
  seed: string,
  resolved: ReturnType<typeof resolveBriefingConfig>,
): { hostId: string; expertId: string; provider: string } {
  const provider = (ttsProvider ?? 'elevenlabs') as 'elevenlabs' | 'openai' | 'kittentts';

  // Try user-specified voice pool names
  let hostEntry: VoicePoolEntry | undefined;
  let expertEntry: VoicePoolEntry | undefined;

  if (user.briefingHostVoiceId) {
    hostEntry = VOICE_POOL.find((v) => v.name === user.briefingHostVoiceId);
  }
  if (user.briefingExpertVoiceId) {
    expertEntry = VOICE_POOL.find((v) => v.name === user.briefingExpertVoiceId);
  }

  // Fall back to smart voice pairing for any unset voices
  if (!hostEntry || !expertEntry) {
    const pair = selectVoicePair(seed, {
      tone: resolved.tone as 'casual' | 'professional' | 'socratic' | 'comedic' | 'satirical' | 'storytelling',
      audienceLevel: resolved.audienceLevel as 'beginner' | 'intermediate' | 'expert',
    });
    if (!hostEntry) hostEntry = pair.host;
    if (!expertEntry) expertEntry = pair.expert;
  }

  return {
    hostId: resolveVoiceId(hostEntry, provider),
    expertId: resolveVoiceId(expertEntry, provider),
    provider,
  };
}

export async function processBriefingScheduler(job: Job<ScheduleBriefingsPayload>): Promise<void> {
  const config = await getBriefingConfig();
  if (!config.enabled) {
    logger.info('Briefing scheduler disabled');
    await job.updateProgress(100);
    return;
  }

  const now = new Date();

  const eligibleUsers = await queryEligibleUsers(config);

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
      const resolved = resolveBriefingConfig(user, config);

      // Filter articles by user interests
      const interestSlugs = user.interests.map((i) => i.tag.slug);
      let userArticles = allArticles;
      if (interestSlugs.length > 0) {
        const matchedUrls = await prisma.ingestedArticle.findMany({
          where: {
            url: { in: allArticles.map((a) => a.url) },
            category: { in: interestSlugs },
          },
          select: { url: true },
        });
        const matchedSet = new Set(matchedUrls.map((m) => m.url));
        const matched = allArticles.filter((a) => matchedSet.has(a.url));
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

      // Build source content — prepend custom prompt if set
      const sourceContent = resolved.prompt
        ? `[Custom Focus]\n${resolved.prompt}\n\n[Articles]\n${sourceText}`
        : sourceText;

      // Resolve voices (provider-agnostic → provider-specific IDs)
      const seed = `briefing-${user.id}-${now.toISOString().slice(0, 10)}`;
      const voices = resolveVoices(user, resolved.ttsProvider, seed, resolved);

      const slug = await generatePodcastSlug(title, user.id, prisma);

      // Determine BYOK usage
      const userHasByok = resolved.useByokKeys
        ? (await hasByokKey(user.id)) || (await hasAiKey(user.id))
        : false;
      const useAdminCredits = !userHasByok;

      // Create podcast + discovery + briefing log
      const podcast = await prisma.podcast.create({
        data: {
          userId: user.id,
          title,
          slug,
          topic: `Daily briefing: ${selected.map((a) => a.title).join(', ')}`,
          status: 'EXTRACTING',
          source: 'BRIEFING',
          visibility: user.briefingVisibility,
          aiModel: resolved.aiModel,
          ttsProvider: resolved.ttsProvider,
          ttsModel: resolved.ttsModel,
          voices: {
            createMany: {
              data: [
                { speaker: 'Host', voiceId: voices.hostId, provider: voices.provider },
                { speaker: 'Expert', voiceId: voices.expertId, provider: voices.provider },
              ],
            },
          },
          discovery: {
            create: {
              topic: title,
              depth: resolved.depth,
              audienceLevel: resolved.audienceLevel,
              tone: resolved.tone,
              durationTarget: resolved.durationTarget,
              sourceContent,
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
        userId: useAdminCredits ? (systemUser?.id ?? user.id) : user.id,
        sourceText: sourceContent,
        useAdminCredits,
      });

      generated++;
      logger.info('Briefing created', { userId: user.id, podcastId: podcast.id, byok: !useAdminCredits });
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
