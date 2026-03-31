import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { fetchNewsletterArticles, formatArticlesForPrompt, type NewsArticle } from '@/lib/newsletter-fetcher';
import { addJob, JobType, contentExtractionQueue } from '@/lib/queue';
import { selectVoicePair, resolveVoiceId, VOICE_POOL, type VoicePoolEntry } from '@/lib/voice-pool';
import { generatePodcastSlug } from '@/lib/slugify';
import { hasByokKey, hasAiKey } from '@/lib/byok';
import { getBriefingConfig, type BriefingConfigData } from '@/lib/briefing-config';
import { logger } from '@/lib/logger';
import type { UserBriefing, PodcastVisibility } from '@prisma/client';

// ─── Types ───────────────────────────────────────────────────────

export type BriefingWithUser = UserBriefing & {
  user: {
    id: string;
    preferredAiModel: string | null;
    preferredTtsProvider: string | null;
    preferredTtsModel: string | null;
    bannedAt: Date | null;
    interests: Array<{ tag: { slug: string } }>;
  };
};

interface ResolvedConfig {
  aiModel: string | null;
  ttsProvider: string | null;
  ttsModel: string | null;
  depth: string;
  tone: string;
  audienceLevel: string;
  durationTarget: number;
  format: number;
  prompt: string | null;
  useByokKeys: boolean;
  visibility: PodcastVisibility;
  targetLanguage: string | null;
  languageMode: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Build a concise subtitle from article titles (first 3 + "and N more"). */
function briefingSubtitle(articles: NewsArticle[]): string {
  const MAX_SHOWN = 3;
  const shown = articles.slice(0, MAX_SHOWN).map((a) => a.title);
  const remaining = articles.length - shown.length;
  const suffix = remaining > 0 ? `, and ${remaining} more` : '';
  return shown.join(', ') + suffix;
}

// ─── nextRunAt Computation ───────────────────────────────────────

/**
 * Compute the next eligible run time for a briefing.
 * Scans up to 8 days ahead to find the next matching day in the bitmask.
 */
export function computeNextRunAt(
  time: string,
  timezone: string,
  days: number,
  after: Date = new Date(),
): Date | null {
  if (days === 0) return null;
  const [hh, mm] = time.split(':').map(Number);

  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(after.getTime() + offset * 24 * 60 * 60 * 1000);
    const inTz = new Date(candidate.toLocaleString('en-US', { timeZone: timezone }));
    const dayIndex = inTz.getDay(); // 0=Sun
    const bitmask = dayIndex === 0 ? 64 : 1 << (dayIndex - 1);

    if ((days & bitmask) === 0) continue;

    const year = inTz.getFullYear();
    const month = String(inTz.getMonth() + 1).padStart(2, '0');
    const day = String(inTz.getDate()).padStart(2, '0');
    const targetStr = `${year}-${month}-${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;

    const targetInTz = new Date(
      new Date(targetStr).toLocaleString('en-US', { timeZone: timezone }),
    );
    const diff = new Date(targetStr).getTime() - targetInTz.getTime();
    const utcTarget = new Date(new Date(targetStr).getTime() + diff);

    if (offset === 0 && utcTarget <= after) continue;
    return utcTarget;
  }
  return null;
}

// ─── Config Resolution ───────────────────────────────────────────

export function resolveBriefingConfig(
  briefing: UserBriefing,
  userPrefs: { preferredAiModel: string | null; preferredTtsProvider: string | null; preferredTtsModel: string | null },
  adminConfig: BriefingConfigData,
): ResolvedConfig {
  return {
    aiModel: briefing.aiModel ?? userPrefs.preferredAiModel ?? adminConfig.defaultAiModel,
    ttsProvider: briefing.ttsProvider ?? userPrefs.preferredTtsProvider ?? adminConfig.defaultTtsProvider,
    ttsModel: briefing.ttsModel ?? userPrefs.preferredTtsModel ?? adminConfig.defaultTtsModel,
    depth: briefing.depth ?? 'quick_overview',
    tone: briefing.tone ?? 'casual',
    audienceLevel: briefing.audienceLevel ?? 'intermediate',
    durationTarget: briefing.duration ?? adminConfig.targetDurationMinutes,
    format: briefing.format ?? 2,
    prompt: briefing.prompt,
    useByokKeys: briefing.useByokKeys,
    visibility: briefing.visibility,
    targetLanguage: briefing.targetLanguage ?? null,
    languageMode: briefing.languageMode ?? null,
  };
}

// ─── Voice Resolution ────────────────────────────────────────────

const VOICE_POOL_PROVIDERS = new Set<string>(['elevenlabs', 'openai']);

export function resolveVoicesForBriefing(
  briefing: UserBriefing,
  ttsProvider: string | null,
  seed: string,
  resolved: ResolvedConfig,
): { hostId: string; expertId: string; provider: string } {
  const providerKey = ttsProvider ?? 'elevenlabs';
  const isPoolProvider = VOICE_POOL_PROVIDERS.has(providerKey);
  const poolProvider = isPoolProvider ? (providerKey as 'elevenlabs' | 'openai') : 'elevenlabs';

  if (!isPoolProvider) {
    const pair = selectVoicePair(seed, {
      tone: resolved.tone as 'casual' | 'professional' | 'socratic' | 'comedic' | 'satirical' | 'storytelling',
      audienceLevel: resolved.audienceLevel as 'beginner' | 'intermediate' | 'expert',
    });
    return {
      hostId: briefing.hostVoiceId ?? resolveVoiceId(pair.host, poolProvider),
      expertId: briefing.expertVoiceId ?? resolveVoiceId(pair.expert, poolProvider),
      provider: providerKey,
    };
  }

  let hostEntry: VoicePoolEntry | undefined;
  let expertEntry: VoicePoolEntry | undefined;

  if (briefing.hostVoiceId) {
    hostEntry = VOICE_POOL.find((v) => v.name === briefing.hostVoiceId);
  }
  if (briefing.expertVoiceId) {
    expertEntry = VOICE_POOL.find((v) => v.name === briefing.expertVoiceId);
  }

  if (!hostEntry || !expertEntry) {
    const pair = selectVoicePair(seed, {
      tone: resolved.tone as 'casual' | 'professional' | 'socratic' | 'comedic' | 'satirical' | 'storytelling',
      audienceLevel: resolved.audienceLevel as 'beginner' | 'intermediate' | 'expert',
    });
    if (!hostEntry) hostEntry = pair.host;
    if (!expertEntry) expertEntry = pair.expert;
  }

  return {
    hostId: resolveVoiceId(hostEntry, poolProvider),
    expertId: resolveVoiceId(expertEntry, poolProvider),
    provider: providerKey,
  };
}

// ─── Article Fetch + Filter ──────────────────────────────────────

export async function fetchAndFilterArticles(
  briefingId: string,
  interestSlugs: string[],
  config: BriefingConfigData,
) {
  const allArticles = await fetchNewsletterArticles('24h');
  if (allArticles.length === 0) return [];

  let userArticles = allArticles;

  // Filter by interests
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

  // Per-briefing dedup: exclude articles used by THIS briefing in the last 7 days
  const recentLogs = await prisma.briefingLog.findMany({
    where: {
      userBriefingId: briefingId,
      generatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    select: { articleUrls: true },
  });
  const usedUrls = new Set<string>();
  for (const log of recentLogs) {
    for (const url of log.articleUrls) usedUrls.add(url);
  }
  if (usedUrls.size > 0) {
    userArticles = userArticles.filter((a) => !usedUrls.has(a.url));
  }

  return userArticles.slice(0, config.maxArticlesPerBriefing);
}

// ─── Podcast Creation ────────────────────────────────────────────

const FORMAT_SPEAKERS: Record<number, Array<{ name: string; description: string }>> = {
  1: [{ name: 'Host', description: 'Warm, insightful narrator who guides the listener through the news with clarity and personality.' }],
  2: [
    { name: 'Host', description: 'Warm, sets up topics, asks great questions.' },
    { name: 'Expert', description: 'Adds depth, key insights, and context.' },
  ],
  3: [
    { name: 'Host', description: 'Moderates the discussion, keeps conversation flowing.' },
    { name: 'Expert', description: 'Provides deep analysis and context.' },
    { name: 'Analyst', description: 'Offers alternative perspectives and data-driven insights.' },
  ],
  4: [
    { name: 'Host', description: 'Moderates the roundtable, synthesizes key points.' },
    { name: 'Expert', description: 'Provides foundational knowledge.' },
    { name: 'Analyst', description: 'Offers data-driven insights and alternative frameworks.' },
    { name: 'Critic', description: 'Challenges assumptions, represents the skeptic.' },
  ],
};

export async function createBriefingPodcast(
  briefing: BriefingWithUser,
  resolved: ResolvedConfig,
  articles: NewsArticle[],
): Promise<{ podcastId: string }> {
  const now = new Date();
  const scheduledDate = now.toISOString().slice(0, 10);

  const interestSlugs = briefing.user.interests.map((i) => i.tag.slug);
  const topicSlugs = interestSlugs.length > 0 ? interestSlugs : ['general'];

  const title = `${briefing.name} — ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const sourceText = formatArticlesForPrompt(articles);
  const sourceContent = resolved.prompt
    ? `[Custom Focus]\n${resolved.prompt}\n\n[Articles]\n${sourceText}`
    : sourceText;

  const seed = `briefing-${briefing.id}-${scheduledDate}`;
  const voices = resolveVoicesForBriefing(briefing, resolved.ttsProvider, seed, resolved);

  const speakers = FORMAT_SPEAKERS[resolved.format] ?? FORMAT_SPEAKERS[2];
  const voiceEntries = speakers.map((s, i) => {
    if (i === 0) return { speaker: s.name, voiceId: voices.hostId, provider: voices.provider };
    if (i === 1) return { speaker: s.name, voiceId: voices.expertId, provider: voices.provider };
    return { speaker: s.name, voiceId: null as string | null, provider: voices.provider };
  });

  const slug = await generatePodcastSlug(title, briefing.userId, prisma);

  const userHasByok = resolved.useByokKeys
    ? (await hasByokKey(briefing.userId)) || (await hasAiKey(briefing.userId))
    : false;
  const useAdminCredits = !userHasByok;

  const systemUser = await prisma.user.findFirst({
    where: { handle: 'sotto' },
    select: { id: true },
  });

  const podcast = await prisma.podcast.create({
    data: {
      userId: briefing.userId,
      title,
      slug,
      topic: briefingSubtitle(articles),
      status: 'EXTRACTING',
      source: 'BRIEFING',
      visibility: resolved.visibility,
      aiModel: resolved.aiModel,
      ttsProvider: resolved.ttsProvider,
      ttsModel: resolved.ttsModel,
      language: resolved.targetLanguage ?? undefined,
      voices: {
        createMany: {
          data: voiceEntries.map((v) => ({
            speaker: v.speaker,
            voiceId: v.voiceId,
            provider: v.provider,
          })),
        },
      },
      discovery: {
        create: {
          topic: title,
          depth: resolved.depth,
          audienceLevel: resolved.audienceLevel,
          tone: resolved.tone,
          durationTarget: resolved.durationTarget,
          speakers: speakers.length > 0 ? speakers : undefined,
          sourceContent,
          userId: briefing.userId,
        },
      },
    },
  });

  // Create BriefingLog with idempotency key
  await prisma.briefingLog.create({
    data: {
      userId: briefing.userId,
      podcastId: podcast.id,
      topicSlugs,
      articleUrls: articles.map((a) => a.url),
      userBriefingId: briefing.id,
      scheduledDate,
    },
  });

  // Update briefing state
  await prisma.userBriefing.update({
    where: { id: briefing.id },
    data: {
      lastGeneratedAt: now,
      nextRunAt: computeNextRunAt(briefing.time, briefing.timezone, briefing.days, now),
    },
  });

  // Enqueue content extraction
  await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, {
    podcastId: podcast.id,
    userId: useAdminCredits ? (systemUser?.id ?? briefing.userId) : briefing.userId,
    sourceText: sourceContent,
    useAdminCredits,
  });

  logger.info('Briefing podcast created', {
    briefingId: briefing.id,
    podcastId: podcast.id,
    userId: briefing.userId,
    byok: !useAdminCredits,
  });

  return { podcastId: podcast.id };
}

// ─── Re-export config helper ─────────────────────────────────────

export { getBriefingConfig, type BriefingConfigData };
