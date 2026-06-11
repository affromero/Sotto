import { prisma } from './prisma';

type CostBucket = 'text' | 'audio' | 'video' | 'avatar';

export const CATEGORY_BUCKET_MAP: Record<string, CostBucket> = {
  // Text
  topic_assessment: 'text',
  script_generation: 'text',
  script_verification: 'text',
  reference_validation: 'text',
  voice_assignment: 'text',
  'tts-tag-conversion': 'text',
  interaction: 'text',
  discovery: 'text',
  language_detection: 'text',
  handle_screening: 'text',
  telegram_parse: 'text',
  inspire_foryou: 'text',
  inspire_news: 'text',
  inspire_curiosity: 'text',
  name_moderation: 'text',
  credential_lookup: 'text',
  embedding: 'text',
  diarization: 'text',
  import_metadata: 'text',
  moderation: 'text',
  tweet_parse: 'text',
  explore: 'text',
  trending: 'text',

  // Audio
  audio_generation: 'audio',
  stt_transcription: 'audio',
  segment_regeneration: 'audio',
  music_generation: 'audio',
  voice_track_audio: 'audio',

  // Video
  video_generation: 'video',

  // Avatar
  avatar_generation: 'avatar',
};

export function getCostBucket(category: string): CostBucket {
  return CATEGORY_BUCKET_MAP[category] ?? 'text';
}

export interface PodcastCostBreakdown {
  podcastId: string;
  text: number;
  audio: number;
  video: number;
  avatar: number;
  total: number;
  callCount: number;
}

export async function getPodcastCostBreakdown(podcastId: string): Promise<PodcastCostBreakdown> {
  const logs = await prisma.apiUsageLog.groupBy({
    by: ['category'],
    where: { podcastId },
    _sum: { totalCost: true },
    _count: { id: true },
  });

  const result: PodcastCostBreakdown = {
    podcastId,
    text: 0,
    audio: 0,
    video: 0,
    avatar: 0,
    total: 0,
    callCount: 0,
  };

  for (const row of logs) {
    const bucket = getCostBucket(row.category);
    const cost = row._sum.totalCost ?? 0;
    result[bucket] += cost;
    result.total += cost;
    result.callCount += row._count.id;
  }

  return result;
}

export interface UserCostSummary {
  totalCost: number;
  monthCost: number;
  podcastCount: number;
  avgCostPerPodcast: number;
  buckets: { text: number; audio: number; video: number; avatar: number };
}

export async function getUserCostSummary(userId: string): Promise<UserCostSummary> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [allTimeLogs, monthLogs, podcastCount] = await Promise.all([
    prisma.apiUsageLog.groupBy({
      by: ['category'],
      where: { userId },
      _sum: { totalCost: true },
    }),
    prisma.apiUsageLog.groupBy({
      by: ['category'],
      where: { userId, createdAt: { gte: startOfMonth } },
      _sum: { totalCost: true },
    }),
    prisma.podcast.count({ where: { userId } }),
  ]);

  const buckets = { text: 0, audio: 0, video: 0, avatar: 0 };
  let totalCost = 0;

  for (const row of allTimeLogs) {
    const bucket = getCostBucket(row.category);
    const cost = row._sum.totalCost ?? 0;
    buckets[bucket] += cost;
    totalCost += cost;
  }

  let monthCost = 0;
  for (const row of monthLogs) {
    monthCost += row._sum.totalCost ?? 0;
  }

  return {
    totalCost,
    monthCost,
    podcastCount,
    avgCostPerPodcast: podcastCount > 0 ? totalCost / podcastCount : 0,
    buckets,
  };
}

export interface UserCostRow {
  userId: string;
  name: string | null;
  email: string | null;
  totalCost: number;
  monthCost: number;
  podcastCount: number;
}

export async function getTopUsersByCost(
  period: '24h' | '7d' | '30d' | '90d',
  limit: number = 25
): Promise<UserCostRow[]> {
  const periodMs: Record<string, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '90d': 90 * 24 * 60 * 60 * 1000,
  };
  const now = new Date();
  const since = new Date(now.getTime() - periodMs[period]);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [periodLogs, monthLogs] = await Promise.all([
    prisma.apiUsageLog.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: since }, userId: { not: null } },
      _sum: { totalCost: true },
      orderBy: { _sum: { totalCost: 'desc' } },
      take: limit,
    }),
    prisma.apiUsageLog.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: startOfMonth }, userId: { not: null } },
      _sum: { totalCost: true },
    }),
  ]);

  if (periodLogs.length === 0) return [];

  const userIds = periodLogs
    .map((r) => r.userId)
    .filter((id): id is string => id !== null);

  const monthCostMap = new Map<string, number>();
  for (const row of monthLogs) {
    if (row.userId) {
      monthCostMap.set(row.userId, row._sum.totalCost ?? 0);
    }
  }

  const [users, podcastCounts] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    }),
    prisma.podcast.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds } },
      _count: { id: true },
    }),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const countMap = new Map(podcastCounts.map((r) => [r.userId, r._count.id]));

  return periodLogs
    .filter((r) => r.userId !== null)
    .map((row) => {
      const user = userMap.get(row.userId!);
      return {
        userId: row.userId!,
        name: user?.name ?? null,
        email: user?.email ?? null,
        totalCost: row._sum.totalCost ?? 0,
        monthCost: monthCostMap.get(row.userId!) ?? 0,
        podcastCount: countMap.get(row.userId!) ?? 0,
      };
    });
}
