/**
 * Traffic report builder: ~70 aggregation queries → structured JSON
 * for the /api/admin/traffic-report endpoint.
 *
 * All queries run in a single Promise.all for maximum parallelism.
 */

import { subDays, startOfDay } from 'date-fns';
import { prisma } from './prisma';
import { getCostBreakdown, getDailyCostTrend } from './cost-monitor';
import { getAutoModelConfig, type AutoModelConfigData } from './auto-model-config';
import { DURATION_TOLERANCE_SECONDS } from './duration';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert BigInt COUNT(*) results to number. */
const n = (v: bigint) => Number(v);

function mapPeriodToCostPeriod(days: number): '24h' | '7d' | '30d' | '90d' {
  if (days <= 1) return '24h';
  if (days <= 7) return '7d';
  if (days <= 30) return '30d';
  return '90d';
}

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface TrafficReportMeta {
  generatedAt: string;
  periodDays: number;
  since: string;
}

export interface TrafficSection {
  pageViews: number;
  uniqueVisitors: number;
  avgPagesPerSession: number;
  topPages: Array<{ url: string; count: number }>;
  referrers: Array<{ referrer: string; count: number }>;
  countries: Array<{ country: string; count: number }>;
  devices: Array<{ type: string; count: number }>;
  dailyVisitors: Array<{ day: string; count: number }>;
}

export interface WaitlistSection {
  total: number;
  recentSignups: number;
  bySource: Array<{ source: string; count: number }>;
}

export interface UsersSection {
  total: number;
  signupsToday: number;
  signupsThisWeek: number;
  signupsThisMonth: number;
  roleDistribution: Array<{ role: string; count: number }>;
}

export interface PodcastsSection {
  total: number;
  byStatus: Record<string, number>;
  totalPlays: number;
}

export interface PlaybackSection {
  sessionsInPeriod: number;
  avgCompletionPercent: number;
  avgListenSeconds: number;
}

export interface ProvidersSection {
  ttsDistribution: Array<{ provider: string; count: number }>;
  aiProviderDistribution: Array<{ provider: string; count: number }>;
  aiModelDistribution: Array<{ model: string; count: number }>;
  byokAdoption: {
    tts: Array<{ provider: string; userCount: number }>;
    ai: Array<{ provider: string; userCount: number }>;
  };
}

export interface TopicsSection {
  topTags: Array<{ tag: string; slug: string; count: number }>;
  depthDistribution: Array<{ depth: string; count: number }>;
  audienceLevelDistribution: Array<{ level: string; count: number }>;
  toneDistribution: Array<{ tone: string; count: number }>;
  durationTarget: { avg: number | null; median: number | null };
  languageDistribution: Array<{ language: string; count: number }>;
}

export interface SourcesSection {
  sourceDistribution: Array<{ source: string; count: number }>;
  sourcePlatformDistribution: Array<{ platform: string; count: number }>;
  humanVsAi: { human: number; ai: number };
}

export interface PrivateActivitySection {
  totals: { saves: number; questions: number; answered: number; incorporated: number; ratings: number };
  dailyTrend: Array<{ day: string; saves: number; questions: number; ratings: number }>;
  topSaved: Array<{ podcastId: string; title: string; creator: string; saveCount: number }>;
}

export interface InteractionsSection {
  totalQuestions: number;
  byStatus: Record<string, number>;
  answerRate: number;
  incorporationRate: number;
  helpfulRate: number;
  avgQuestionsPerPodcast: number;
  publicVsPrivate: { public: number; private: number };
}

export interface PlaybackDetailsSection {
  totalListenHours: number;
  speedDistribution: Array<{ speed: string; count: number }>;
  avgPausesPerSession: number;
  avgSeeksPerSession: number;
  avgInterruptsPerSession: number;
  completionDistribution: Array<{ bucket: string; count: number }>;
}

export interface ContentSection {
  avgDurationSeconds: number | null;
  avgSegmentsPerPodcast: number | null;
  avgFileSizeBytes: number | null;
  visibilityDistribution: Array<{ visibility: string; count: number }>;
  durationDistribution: Array<{ bucket: string; count: number }>;
  durationAccuracy: {
    total: number;
    withinTarget: number;
    withinTargetPct: number;
    meanAbsDeviation: number;
    avgDeviation: number;
  };
}

export interface FreeTierSection {
  config: AutoModelConfigData;
  usersWithPodcasts: number;
  byokUsersCount: number;
}

export interface PipelineSection {
  totalAttempted: number;
  totalFailed: number;
  failureRate: number;
  failedAtStage: Array<{ stage: string; count: number }>;
  avgTimeToReadySeconds: number | null;
  inProgressByStatus: Array<{ status: string; count: number }>;
}

export interface RecommendationsSection {
  totalImpressions: number;
  totalClicks: number;
  totalQueues: number;
  ctr: number;
  queueRate: number;
  bySurface: Array<{
    surface: string;
    impressions: number;
    clicks: number;
    queues: number;
    ctr: number;
  }>;
  avgListenedPercent: number | null;
}

export interface CollectionsSection {
  total: number;
  totalItems: number;
  newInPeriod: number;
  largestByItems: Array<{
    collectionId: string;
    name: string;
    creator: string;
    podcastCount: number;
  }>;
}

export interface VoicesSection {
  totalClones: number;
  bySourceType: Array<{ sourceType: string; count: number }>;
  requestableCount: number;
  requestsByStatus: Array<{ status: string; count: number }>;
}

export interface ReferralsSection {
  totalAttributed: number;
  totalVerified: number;
  verifiedInPeriod: number;
  conversionRate: number;
}

export interface TrafficReport {
  meta: TrafficReportMeta;
  traffic: TrafficSection;
  waitlist: WaitlistSection;
  users: UsersSection;
  podcasts: PodcastsSection;
  playback: PlaybackSection;
  costs: { breakdown: unknown; dailyTrend: unknown };
  providers: ProvidersSection;
  topics: TopicsSection;
  sources: SourcesSection;
  privateActivity: PrivateActivitySection;
  interactions: InteractionsSection;
  playbackDetails: PlaybackDetailsSection;
  content: ContentSection;
  freeTier: FreeTierSection;
  pipeline: PipelineSection;
  recommendations: RecommendationsSection;
  collections: CollectionsSection;
  voices: VoicesSection;
  referrals: ReferralsSection;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export async function buildTrafficReport(
  since: Date,
  periodDays: number,
): Promise<TrafficReport> {
  const now = new Date();
  const today = startOfDay(now);
  const weekAgo = subDays(today, 7);
  const monthAgo = subDays(today, 30);

  const terminalStatuses = ['READY', 'FAILED'] as const;

  const [
    // === Traffic (8) ===
    pageViews,
    uniqueVisitors,
    topPages,
    referrers,
    countries,
    devices,
    dailyVisitors,
    avgPages,

    // === Waitlist (3) ===
    waitlistTotal,
    waitlistRecent,
    waitlistBySource,

    // === Users (5) ===
    totalUsers,
    signupsToday,
    signupsThisWeek,
    signupsThisMonth,
    roleDistribution,

    // === Podcasts (3) ===
    totalPodcasts,
    podcastsByStatus,
    totalPlays,

    // === Playback (1) ===
    playbackStats,

    // === Costs (2) ===
    costBreakdown,
    dailyCostTrend,

    // === Providers (5) ===
    ttsDistribution,
    aiProviderDistribution,
    aiModelDistribution,
    byokTts,
    byokAi,

    // === Topics (6) ===
    topTags,
    depthDistribution,
    audienceLevelDistribution,
    toneDistribution,
    durationTargetRaw,
    languageDistribution,

    // === Sources (3) ===
    sourceDistribution,
    sourcePlatformDistribution,
    humanVsAiRaw,

    // === Private Activity (7) ===
    savesCount,
    questionsCount,
    answeredQuestionsCount,
    incorporatedAnswersCount,
    ratingsCount,
    dailyPrivateActivity,
    topSavedPodcasts,

    // === Interactions (5) ===
    totalQuestions,
    interactionsByStatus,
    interactionsByHelpful,
    avgQuestionsPerPodcast,
    interactionsByVisibility,

    // === Playback Details (3) ===
    playbackAgg,
    speedBuckets,
    completionBuckets,

    // === Content (7) ===
    contentAgg,
    avgSegments,
    visibilityDistribution,
    durationBuckets,
    durationAccuracyTotal,
    durationAccuracyWithinTarget,
    durationAccuracyStats,

    // === Free Tier (3) ===
    autoModelConfig,
    usersWithPodcasts,
    byokUsersCount,

    // === Pipeline (5) ===
    pipelineAttempted,
    pipelineFailed,
    failedAtStage,
    avgTimeToReady,
    inProgressByStatus,

    // === Recommendations (2) ===
    recsAgg,
    recsBySurface,

    // === Collections (4) ===
    collectionsTotal,
    collectionItemsTotal,
    collectionsNewInPeriod,
    largestCollections,

    // === Voices (4) ===
    voiceClonesTotal,
    voicesBySourceType,
    voicesRequestable,
    voiceRequestsByStatus,

    // === Referrals (3) ===
    referralAttributed,
    referralVerified,
    referralVerifiedInPeriod,
  ] = await Promise.all([
    // -----------------------------------------------------------------------
    // Traffic
    // -----------------------------------------------------------------------
    prisma.behavioralEvent.count({
      where: { eventType: 'page.view', createdAt: { gte: since } },
    }),
    prisma.userSession.count({
      where: { startedAt: { gte: since } },
    }),
    prisma.behavioralEvent.groupBy({
      by: ['pageUrl'],
      where: { eventType: 'page.view', createdAt: { gte: since }, pageUrl: { not: null } },
      _count: true,
      orderBy: { _count: { pageUrl: 'desc' } },
      take: 20,
    }),
    prisma.userSession.groupBy({
      by: ['referrer'],
      where: { startedAt: { gte: since }, referrer: { not: null } },
      _count: true,
      orderBy: { _count: { referrer: 'desc' } },
      take: 15,
    }),
    prisma.userSession.groupBy({
      by: ['country'],
      where: { startedAt: { gte: since }, country: { not: null } },
      _count: true,
      orderBy: { _count: { country: 'desc' } },
      take: 15,
    }),
    prisma.userSession.groupBy({
      by: ['deviceType'],
      where: { startedAt: { gte: since } },
      _count: true,
    }),
    prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT DATE_TRUNC('day', "startedAt") AS day, COUNT(*)::bigint AS count
      FROM "UserSession"
      WHERE "startedAt" >= ${since}
      GROUP BY DATE_TRUNC('day', "startedAt")
      ORDER BY day ASC
    `,
    prisma.userSession.aggregate({
      where: { startedAt: { gte: since } },
      _avg: { pageCount: true },
    }),

    // -----------------------------------------------------------------------
    // Waitlist
    // -----------------------------------------------------------------------
    prisma.waitlist.count(),
    prisma.waitlist.count({ where: { createdAt: { gte: since } } }),
    prisma.waitlist.groupBy({
      by: ['source'],
      _count: true,
      orderBy: { _count: { source: 'desc' } },
    }),

    // -----------------------------------------------------------------------
    // Users
    // -----------------------------------------------------------------------
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: today } } }),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { createdAt: { gte: monthAgo } } }),
    prisma.user.groupBy({
      by: ['role'],
      _count: true,
    }),

    // -----------------------------------------------------------------------
    // Podcasts
    // -----------------------------------------------------------------------
    prisma.podcast.count(),
    prisma.podcast.groupBy({ by: ['status'], _count: true }),
    prisma.podcast.aggregate({ _sum: { playCount: true } }),

    // -----------------------------------------------------------------------
    // Playback
    // -----------------------------------------------------------------------
    prisma.playbackSession.aggregate({
      where: { startedAt: { gte: since } },
      _avg: { completionPercent: true, totalListenSeconds: true },
      _count: { id: true },
    }),

    // -----------------------------------------------------------------------
    // Costs
    // -----------------------------------------------------------------------
    getCostBreakdown(mapPeriodToCostPeriod(periodDays)),
    getDailyCostTrend(periodDays),

    // -----------------------------------------------------------------------
    // Providers
    // -----------------------------------------------------------------------
    prisma.podcast.groupBy({
      by: ['ttsProvider'],
      where: { createdAt: { gte: since }, ttsProvider: { not: null } },
      _count: true,
      orderBy: { _count: { ttsProvider: 'desc' } },
    }),
    prisma.podcast.groupBy({
      by: ['aiProvider'],
      where: { createdAt: { gte: since }, aiProvider: { not: null } },
      _count: true,
      orderBy: { _count: { aiProvider: 'desc' } },
    }),
    prisma.podcast.groupBy({
      by: ['aiModel'],
      where: { createdAt: { gte: since }, aiModel: { not: null } },
      _count: true,
      orderBy: { _count: { aiModel: 'desc' } },
    }),
    prisma.userTtsKey.groupBy({
      by: ['provider'],
      where: { isValid: true },
      _count: true,
      orderBy: { _count: { provider: 'desc' } },
    }),
    prisma.userAiKey.groupBy({
      by: ['provider'],
      where: { isValid: true },
      _count: true,
      orderBy: { _count: { provider: 'desc' } },
    }),

    // -----------------------------------------------------------------------
    // Topics
    // -----------------------------------------------------------------------
    prisma.$queryRaw<Array<{ tag: string; slug: string; count: bigint }>>`
      SELECT t."name" AS tag, t."slug", COUNT(*)::bigint AS count
      FROM "PodcastTag" pt
      JOIN "Tag" t ON t."id" = pt."tagId"
      JOIN "Podcast" p ON p."id" = pt."podcastId"
      WHERE p."createdAt" >= ${since} AND p."deletedAt" IS NULL
      GROUP BY t."name", t."slug"
      ORDER BY count DESC
      LIMIT 20
    `,
    prisma.discovery.groupBy({
      by: ['depth'],
      where: { createdAt: { gte: since }, depth: { not: null } },
      _count: true,
      orderBy: { _count: { depth: 'desc' } },
    }),
    prisma.discovery.groupBy({
      by: ['audienceLevel'],
      where: { createdAt: { gte: since }, audienceLevel: { not: null } },
      _count: true,
      orderBy: { _count: { audienceLevel: 'desc' } },
    }),
    prisma.discovery.groupBy({
      by: ['tone'],
      where: { createdAt: { gte: since }, tone: { not: null } },
      _count: true,
      orderBy: { _count: { tone: 'desc' } },
    }),
    prisma.$queryRaw<Array<{ avg: number | null; median: number | null }>>`
      SELECT
        AVG("durationTarget")::float AS avg,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "durationTarget")::float AS median
      FROM "Discovery"
      WHERE "createdAt" >= ${since}
        AND "durationTarget" IS NOT NULL
    `,
    prisma.podcast.groupBy({
      by: ['language'],
      where: { createdAt: { gte: since }, language: { not: null } },
      _count: true,
      orderBy: { _count: { language: 'desc' } },
    }),

    // -----------------------------------------------------------------------
    // Sources
    // -----------------------------------------------------------------------
    prisma.podcast.groupBy({
      by: ['source'],
      where: { createdAt: { gte: since } },
      _count: true,
      orderBy: { _count: { source: 'desc' } },
    }),
    prisma.podcast.groupBy({
      by: ['sourcePlatform'],
      where: { createdAt: { gte: since }, sourcePlatform: { not: null } },
      _count: true,
      orderBy: { _count: { sourcePlatform: 'desc' } },
    }),
    prisma.podcast.groupBy({
      by: ['isHumanContent'],
      where: { createdAt: { gte: since } },
      _count: true,
    }),

    // -----------------------------------------------------------------------
    // Private Activity
    // -----------------------------------------------------------------------
    prisma.save.count({ where: { createdAt: { gte: since } } }),
    prisma.interaction.count({ where: { createdAt: { gte: since } } }),
    prisma.interaction.count({
      where: {
        createdAt: { gte: since },
        status: { in: ['ANSWERED', 'INCORPORATED', 'RESOLVED'] },
      },
    }),
    prisma.interaction.count({ where: { createdAt: { gte: since }, incorporated: true } }),
    prisma.podcastRating.count({ where: { createdAt: { gte: since } } }),
    prisma.$queryRaw<Array<{ day: Date; saves: bigint; questions: bigint; ratings: bigint }>>`
      WITH days AS (
        SELECT generate_series(${since}::date, NOW()::date, '1 day'::interval)::date AS day
      )
      SELECT
        d.day,
        COALESCE((SELECT COUNT(*) FROM "Save" WHERE "createdAt"::date = d.day AND "createdAt" >= ${since}), 0)::bigint AS saves,
        COALESCE((SELECT COUNT(*) FROM "Interaction" WHERE "createdAt"::date = d.day AND "createdAt" >= ${since}), 0)::bigint AS questions,
        COALESCE((SELECT COUNT(*) FROM "PodcastRating" WHERE "createdAt"::date = d.day AND "createdAt" >= ${since}), 0)::bigint AS ratings
      FROM days d
      ORDER BY d.day ASC
    `,
    prisma.podcast.findMany({
      where: { deletedAt: null, saveCount: { gt: 0 } },
      orderBy: { saveCount: 'desc' },
      take: 10,
      select: { id: true, title: true, saveCount: true, user: { select: { name: true, handle: true } } },
    }),

    // -----------------------------------------------------------------------
    // Interactions
    // -----------------------------------------------------------------------
    prisma.interaction.count({ where: { createdAt: { gte: since } } }),
    prisma.interaction.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since } },
      _count: true,
    }),
    prisma.interaction.groupBy({
      by: ['helpful'],
      where: { createdAt: { gte: since }, helpful: { not: null } },
      _count: true,
    }),
    prisma.$queryRaw<[{ avg: number | null }]>`
      SELECT AVG(q.cnt)::float AS avg
      FROM (
        SELECT "podcastId", COUNT(*)::int AS cnt
        FROM "Interaction"
        WHERE "createdAt" >= ${since}
        GROUP BY "podcastId"
      ) q
    `,
    prisma.interaction.groupBy({
      by: ['visibility'],
      where: { createdAt: { gte: since } },
      _count: true,
    }),

    // -----------------------------------------------------------------------
    // Playback Details
    // -----------------------------------------------------------------------
    prisma.playbackSession.aggregate({
      where: { startedAt: { gte: since } },
      _sum: { totalListenSeconds: true },
      _avg: { pauseCount: true, seekCount: true, interruptCount: true },
    }),
    prisma.$queryRaw<Array<{ speed: string; count: bigint }>>`
      SELECT
        CASE
          WHEN "lastSpeed" < 1.0 THEN 'below_1x'
          WHEN "lastSpeed" = 1.0 THEN '1x'
          WHEN "lastSpeed" <= 1.25 THEN '1.25x'
          WHEN "lastSpeed" <= 1.5 THEN '1.5x'
          WHEN "lastSpeed" <= 2.0 THEN '2x'
          ELSE 'above_2x'
        END AS speed,
        COUNT(*)::bigint AS count
      FROM "PlaybackSession"
      WHERE "startedAt" >= ${since}
      GROUP BY speed
      ORDER BY count DESC
    `,
    prisma.$queryRaw<Array<{ bucket: string; count: bigint }>>`
      SELECT
        CASE
          WHEN "completionPercent" < 25 THEN '0-25%'
          WHEN "completionPercent" < 50 THEN '25-50%'
          WHEN "completionPercent" < 75 THEN '50-75%'
          ELSE '75-100%'
        END AS bucket,
        COUNT(*)::bigint AS count
      FROM "PlaybackSession"
      WHERE "startedAt" >= ${since}
      GROUP BY bucket
      ORDER BY bucket ASC
    `,

    // -----------------------------------------------------------------------
    // Content
    // -----------------------------------------------------------------------
    prisma.podcast.aggregate({
      where: { status: 'READY' },
      _avg: { duration: true, fileSize: true },
    }),
    prisma.$queryRaw<[{ avg: number | null }]>`
      SELECT AVG(seg_count)::float AS avg
      FROM (
        SELECT "podcastId", COUNT(*)::int AS seg_count
        FROM "Segment"
        GROUP BY "podcastId"
      ) s
    `,
    prisma.podcast.groupBy({
      by: ['visibility'],
      _count: true,
    }),
    prisma.$queryRaw<Array<{ bucket: string; count: bigint }>>`
      SELECT
        CASE
          WHEN "duration" IS NULL THEN 'unknown'
          WHEN "duration" < 300 THEN '<5min'
          WHEN "duration" < 600 THEN '5-10min'
          WHEN "duration" < 1200 THEN '10-20min'
          WHEN "duration" < 1800 THEN '20-30min'
          ELSE '30min+'
        END AS bucket,
        COUNT(*)::bigint AS count
      FROM "Podcast"
      WHERE "status" = 'READY' AND "deletedAt" IS NULL
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
    prisma.podcast.count({
      where: { durationDeviation: { not: null }, status: 'READY', deletedAt: null },
    }),
    prisma.podcast.count({
      where: {
        durationDeviation: {
          gte: -DURATION_TOLERANCE_SECONDS,
          lte: DURATION_TOLERANCE_SECONDS,
        },
        status: 'READY',
        deletedAt: null,
      },
    }),
    prisma.$queryRaw<[{ mean_abs: number | null; avg_dev: number | null }]>`
      SELECT
        AVG(ABS("durationDeviation"))::float AS mean_abs,
        AVG("durationDeviation")::float AS avg_dev
      FROM "Podcast"
      WHERE "durationDeviation" IS NOT NULL
        AND "status" = 'READY'
        AND "deletedAt" IS NULL
    `,

    // -----------------------------------------------------------------------
    // Free Tier
    // -----------------------------------------------------------------------
    getAutoModelConfig(),
    prisma.user.count({ where: { podcasts: { some: {} } } }),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT ak."userId")::bigint AS count
      FROM "UserAiKey" ak
      JOIN "UserTtsKey" tk ON tk."userId" = ak."userId"
      WHERE ak."isValid" = true AND tk."isValid" = true
    `,

    // -----------------------------------------------------------------------
    // Pipeline
    // -----------------------------------------------------------------------
    prisma.podcast.count({
      where: { createdAt: { gte: since }, source: { not: 'IMPORT' } },
    }),
    prisma.podcast.count({
      where: { createdAt: { gte: since }, status: 'FAILED', source: { not: 'IMPORT' } },
    }),
    prisma.podcast.groupBy({
      by: ['failedAtStatus'],
      where: { createdAt: { gte: since }, failedAtStatus: { not: null } },
      _count: true,
      orderBy: { _count: { failedAtStatus: 'desc' } },
    }),
    prisma.$queryRaw<[{ avg: number | null }]>`
      SELECT AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")))::float AS avg
      FROM "Podcast"
      WHERE "status" = 'READY'
        AND "deletedAt" IS NULL
        AND "source" != 'IMPORT'
        AND "createdAt" >= ${since}
    `,
    prisma.podcast.groupBy({
      by: ['status'],
      where: {
        status: { notIn: [...terminalStatuses, 'PENDING'] },
      },
      _count: true,
    }),

    // -----------------------------------------------------------------------
    // Recommendations
    // -----------------------------------------------------------------------
    prisma.$queryRaw<[{
      impressions: bigint;
      clicks: bigint;
      queues: bigint;
      avg_listened: number | null;
    }]>`
      SELECT
        COUNT(*) FILTER (WHERE "impressed" = true)::bigint AS impressions,
        COUNT(*) FILTER (WHERE "clicked" = true)::bigint AS clicks,
        COUNT(*) FILTER (WHERE "queued" = true)::bigint AS queues,
        AVG("listenedPercent") FILTER (WHERE "listenedPercent" IS NOT NULL)::float AS avg_listened
      FROM "RecommendationLog"
      WHERE "createdAt" >= ${since}
    `,
    prisma.$queryRaw<Array<{
      surface: string;
      impressions: bigint;
      clicks: bigint;
      queues: bigint;
    }>>`
      SELECT
        "surface",
        COUNT(*) FILTER (WHERE "impressed" = true)::bigint AS impressions,
        COUNT(*) FILTER (WHERE "clicked" = true)::bigint AS clicks,
        COUNT(*) FILTER (WHERE "queued" = true)::bigint AS queues
      FROM "RecommendationLog"
      WHERE "createdAt" >= ${since}
      GROUP BY "surface"
      ORDER BY impressions DESC
    `,

    // -----------------------------------------------------------------------
    // Collections
    // -----------------------------------------------------------------------
    prisma.collection.count(),
    prisma.collectionItem.count(),
    prisma.collection.count({ where: { createdAt: { gte: since } } }),
    prisma.collection.findMany({
      where: { podcastCount: { gt: 0 } },
      orderBy: { podcastCount: 'desc' },
      take: 5,
      select: {
        id: true,
        name: true,
        podcastCount: true,
        user: { select: { name: true, handle: true } },
      },
    }),

    // -----------------------------------------------------------------------
    // Voices
    // -----------------------------------------------------------------------
    prisma.voiceClone.count(),
    prisma.voiceClone.groupBy({
      by: ['sourceType'],
      _count: true,
    }),
    prisma.voiceClone.count({ where: { requestable: true } }),
    prisma.voiceRequest.groupBy({
      by: ['status'],
      _count: true,
    }),

    // -----------------------------------------------------------------------
    // Referrals
    // -----------------------------------------------------------------------
    prisma.user.count({ where: { referredById: { not: null } } }),
    prisma.user.count({ where: { referralVerified: true } }),
    prisma.user.count({ where: { referralVerified: true, referralVerifiedAt: { gte: since } } }),
  ]);

  // =========================================================================
  // Assemble response
  // =========================================================================

  // --- Helpers for derived metrics ---
  const statusMap = Object.fromEntries(
    interactionsByStatus.map((s) => [s.status, s._count]),
  );
  const answered =
    (statusMap['ANSWERED'] ?? 0) +
    (statusMap['RESOLVED'] ?? 0) +
    (statusMap['INCORPORATING'] ?? 0) +
    (statusMap['INCORPORATED'] ?? 0);
  const incorporated = statusMap['INCORPORATED'] ?? 0;
  const helpfulTrue =
    interactionsByHelpful.find((h) => h.helpful === true)?._count ?? 0;
  const helpfulFalse =
    interactionsByHelpful.find((h) => h.helpful === false)?._count ?? 0;
  const helpfulTotal = helpfulTrue + helpfulFalse;

  const recsRow = recsAgg[0] ?? { impressions: 0n, clicks: 0n, queues: 0n, avg_listened: null };
  const impressions = n(recsRow.impressions as bigint);
  const clicks = n(recsRow.clicks as bigint);
  const queues = n(recsRow.queues as bigint);

  const creatorLabel = (user: { name: string | null; handle: string | null }) =>
    user.handle ? `@${user.handle}` : user.name ?? 'Unknown';

  return {
    meta: {
      generatedAt: now.toISOString(),
      periodDays,
      since: since.toISOString(),
    },

    traffic: {
      pageViews,
      uniqueVisitors,
      avgPagesPerSession: avgPages._avg.pageCount ?? 0,
      topPages: topPages.map((p) => ({
        url: p.pageUrl ?? 'Unknown',
        count: p._count,
      })),
      referrers: referrers.map((r) => ({
        referrer: r.referrer ?? 'Direct',
        count: r._count,
      })),
      countries: countries.map((c) => ({
        country: c.country ?? 'Unknown',
        count: c._count,
      })),
      devices: devices.map((d) => ({
        type: d.deviceType ?? 'Unknown',
        count: d._count,
      })),
      dailyVisitors: dailyVisitors.map((d) => ({
        day: d.day.toISOString().split('T')[0],
        count: n(d.count),
      })),
    },

    waitlist: {
      total: waitlistTotal,
      recentSignups: waitlistRecent,
      bySource: waitlistBySource.map((s) => ({
        source: s.source ?? 'unknown',
        count: s._count,
      })),
    },

    users: {
      total: totalUsers,
      signupsToday,
      signupsThisWeek,
      signupsThisMonth,
      roleDistribution: roleDistribution.map((r) => ({
        role: r.role,
        count: r._count,
      })),
    },

    podcasts: {
      total: totalPodcasts,
      byStatus: Object.fromEntries(
        podcastsByStatus.map((s) => [s.status, s._count]),
      ),
      totalPlays: totalPlays._sum.playCount ?? 0,
    },

    playback: {
      sessionsInPeriod: playbackStats._count.id,
      avgCompletionPercent: playbackStats._avg.completionPercent ?? 0,
      avgListenSeconds: playbackStats._avg.totalListenSeconds ?? 0,
    },

    costs: {
      breakdown: costBreakdown,
      dailyTrend: dailyCostTrend,
    },

    providers: {
      ttsDistribution: ttsDistribution.map((r) => ({
        provider: r.ttsProvider!,
        count: r._count,
      })),
      aiProviderDistribution: aiProviderDistribution.map((r) => ({
        provider: r.aiProvider!,
        count: r._count,
      })),
      aiModelDistribution: aiModelDistribution.map((r) => ({
        model: r.aiModel!,
        count: r._count,
      })),
      byokAdoption: {
        tts: byokTts.map((r) => ({ provider: r.provider, userCount: r._count })),
        ai: byokAi.map((r) => ({ provider: r.provider, userCount: r._count })),
      },
    },

    topics: {
      topTags: topTags.map((r) => ({
        tag: r.tag,
        slug: r.slug,
        count: n(r.count),
      })),
      depthDistribution: depthDistribution.map((r) => ({
        depth: r.depth!,
        count: r._count,
      })),
      audienceLevelDistribution: audienceLevelDistribution.map((r) => ({
        level: r.audienceLevel!,
        count: r._count,
      })),
      toneDistribution: toneDistribution.map((r) => ({
        tone: r.tone!,
        count: r._count,
      })),
      durationTarget: {
        avg: durationTargetRaw[0]?.avg ?? null,
        median: durationTargetRaw[0]?.median ?? null,
      },
      languageDistribution: languageDistribution.map((r) => ({
        language: r.language!,
        count: r._count,
      })),
    },

    sources: {
      sourceDistribution: sourceDistribution.map((r) => ({
        source: r.source,
        count: r._count,
      })),
      sourcePlatformDistribution: sourcePlatformDistribution.map((r) => ({
        platform: r.sourcePlatform!,
        count: r._count,
      })),
      humanVsAi: {
        human: humanVsAiRaw.find((r) => r.isHumanContent === true)?._count ?? 0,
        ai: humanVsAiRaw.find((r) => r.isHumanContent === false)?._count ?? 0,
      },
    },

    privateActivity: {
      totals: {
        saves: savesCount,
        questions: questionsCount,
        answered: answeredQuestionsCount,
        incorporated: incorporatedAnswersCount,
        ratings: ratingsCount,
      },
      dailyTrend: dailyPrivateActivity.map((d) => ({
        day: d.day instanceof Date
          ? d.day.toISOString().split('T')[0]
          : String(d.day),
        saves: n(d.saves),
        questions: n(d.questions),
        ratings: n(d.ratings),
      })),
      topSaved: topSavedPodcasts.map((p) => ({
        podcastId: p.id,
        title: p.title,
        creator: creatorLabel(p.user),
        saveCount: p.saveCount,
      })),
    },

    interactions: {
      totalQuestions,
      byStatus: statusMap,
      answerRate: totalQuestions > 0 ? answered / totalQuestions : 0,
      incorporationRate: totalQuestions > 0 ? incorporated / totalQuestions : 0,
      helpfulRate: helpfulTotal > 0 ? helpfulTrue / helpfulTotal : 0,
      avgQuestionsPerPodcast: avgQuestionsPerPodcast[0]?.avg ?? 0,
      publicVsPrivate: {
        public:
          interactionsByVisibility.find((v) => v.visibility === 'PUBLIC')?._count ?? 0,
        private:
          interactionsByVisibility.find((v) => v.visibility === 'PRIVATE')?._count ?? 0,
      },
    },

    playbackDetails: {
      totalListenHours:
        (playbackAgg._sum.totalListenSeconds ?? 0) / 3600,
      speedDistribution: speedBuckets.map((r) => ({
        speed: r.speed,
        count: n(r.count),
      })),
      avgPausesPerSession: playbackAgg._avg.pauseCount ?? 0,
      avgSeeksPerSession: playbackAgg._avg.seekCount ?? 0,
      avgInterruptsPerSession: playbackAgg._avg.interruptCount ?? 0,
      completionDistribution: completionBuckets.map((r) => ({
        bucket: r.bucket,
        count: n(r.count),
      })),
    },

    content: {
      avgDurationSeconds: contentAgg._avg.duration ?? null,
      avgSegmentsPerPodcast: avgSegments[0]?.avg ?? null,
      avgFileSizeBytes: contentAgg._avg.fileSize ?? null,
      visibilityDistribution: visibilityDistribution.map((r) => ({
        visibility: r.visibility,
        count: r._count,
      })),
      durationDistribution: durationBuckets.map((r) => ({
        bucket: r.bucket,
        count: n(r.count),
      })),
      durationAccuracy: {
        total: durationAccuracyTotal,
        withinTarget: durationAccuracyWithinTarget,
        withinTargetPct:
          durationAccuracyTotal > 0
            ? Math.round((durationAccuracyWithinTarget / durationAccuracyTotal) * 100)
            : 0,
        meanAbsDeviation: Math.round(durationAccuracyStats[0]?.mean_abs ?? 0),
        avgDeviation: Math.round(durationAccuracyStats[0]?.avg_dev ?? 0),
      },
    },

    freeTier: {
      config: autoModelConfig,
      usersWithPodcasts: usersWithPodcasts,
      byokUsersCount: n(byokUsersCount[0]?.count ?? 0n),
    },

    pipeline: {
      totalAttempted: pipelineAttempted,
      totalFailed: pipelineFailed,
      failureRate: pipelineAttempted > 0 ? pipelineFailed / pipelineAttempted : 0,
      failedAtStage: failedAtStage.map((r) => ({
        stage: r.failedAtStatus!,
        count: r._count,
      })),
      avgTimeToReadySeconds: avgTimeToReady[0]?.avg ?? null,
      inProgressByStatus: inProgressByStatus.map((r) => ({
        status: r.status,
        count: r._count,
      })),
    },

    recommendations: {
      totalImpressions: impressions,
      totalClicks: clicks,
      totalQueues: queues,
      ctr: impressions > 0 ? clicks / impressions : 0,
      queueRate: impressions > 0 ? queues / impressions : 0,
      bySurface: recsBySurface.map((r) => {
        const imp = n(r.impressions as bigint);
        return {
          surface: r.surface,
          impressions: imp,
          clicks: n(r.clicks as bigint),
          queues: n(r.queues as bigint),
          ctr: imp > 0 ? n(r.clicks as bigint) / imp : 0,
        };
      }),
      avgListenedPercent: recsRow.avg_listened,
    },

    collections: {
      total: collectionsTotal,
      totalItems: collectionItemsTotal,
      newInPeriod: collectionsNewInPeriod,
      largestByItems: largestCollections.map((c) => ({
        collectionId: c.id,
        name: c.name,
        creator: creatorLabel(c.user),
        podcastCount: c.podcastCount,
      })),
    },

    voices: {
      totalClones: voiceClonesTotal,
      bySourceType: voicesBySourceType.map((r) => ({
        sourceType: r.sourceType,
        count: r._count,
      })),
      requestableCount: voicesRequestable,
      requestsByStatus: voiceRequestsByStatus.map((r) => ({
        status: r.status,
        count: r._count,
      })),
    },

    referrals: {
      totalAttributed: referralAttributed,
      totalVerified: referralVerified,
      verifiedInPeriod: referralVerifiedInPeriod,
      conversionRate: referralAttributed > 0 ? referralVerified / referralAttributed : 0,
    },
  };
}
