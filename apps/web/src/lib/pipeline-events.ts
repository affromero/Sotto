import { prisma } from './prisma';

export interface RecentPipelineError {
  id: string;
  podcastId: string;
  podcastTitle: string;
  createdAt: Date;
  stage: string;
  type: string;
  message: string;
  metadata: Record<string, unknown> | null;
}

export async function getRecentPipelineErrors(
  limit: number = 20,
): Promise<RecentPipelineError[]> {
  const events = await prisma.pipelineEvent.findMany({
    where: { type: { in: ['error', 'retry'] } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      podcastId: true,
      createdAt: true,
      stage: true,
      type: true,
      message: true,
      metadata: true,
      podcast: {
        select: { title: true },
      },
    },
  });

  return events.map((e) => ({
    id: e.id,
    podcastId: e.podcastId,
    podcastTitle: e.podcast.title,
    createdAt: e.createdAt,
    stage: e.stage,
    type: e.type,
    message: e.message,
    metadata: e.metadata as Record<string, unknown> | null,
  }));
}

export interface RecentDiscoveryChatError {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  userMessage: string;
  errorKind: string;
  errorDetail: string | null;
  discoveryId: string | null;
  createdAt: Date;
}

export interface DiscoveryChatErrorStats {
  total: number;
  byKind: Record<string, number>;
  daily: Array<{ date: string; total: number; byKind: Record<string, number> }>;
}

export async function getDiscoveryChatErrorStats(
  since: Date,
  until?: Date,
): Promise<DiscoveryChatErrorStats> {
  const where = {
    createdAt: {
      gte: since,
      ...(until ? { lt: until } : {}),
    },
  };

  const [kindCounts, rawRows] = await Promise.all([
    prisma.discoveryChatError.groupBy({
      by: ['errorKind'],
      where,
      _count: { _all: true },
    }),
    prisma.discoveryChatError.findMany({
      where,
      select: { createdAt: true, errorKind: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const total = kindCounts.reduce((sum, k) => sum + k._count._all, 0);
  const byKind: Record<string, number> = {};
  for (const k of kindCounts) byKind[k.errorKind] = k._count._all;

  // Build daily map
  const dailyMap = new Map<string, Record<string, number>>();
  for (const row of rawRows) {
    const day = row.createdAt.toISOString().slice(0, 10);
    if (!dailyMap.has(day)) dailyMap.set(day, {});
    const d = dailyMap.get(day)!;
    d[row.errorKind] = (d[row.errorKind] ?? 0) + 1;
  }

  // Fill all days in range (up to today or until)
  const end = until ? new Date(until.getTime() - 1) : new Date();
  const daily: DiscoveryChatErrorStats['daily'] = [];
  const cur = new Date(since);
  while (cur <= end) {
    const day = cur.toISOString().slice(0, 10);
    const counts = dailyMap.get(day) ?? {};
    daily.push({
      date: day,
      byKind: counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    });
    cur.setDate(cur.getDate() + 1);
  }

  return { total, byKind, daily };
}

export async function getRecentDiscoveryChatErrors(
  limit: number = 50,
  kindFilter?: string,
  sort: 'asc' | 'desc' = 'desc',
  since?: Date,
  until?: Date,
): Promise<RecentDiscoveryChatError[]> {
  const errors = await prisma.discoveryChatError.findMany({
    where: {
      ...(kindFilter ? { errorKind: kindFilter } : {}),
      ...(since || until
        ? {
            createdAt: {
              ...(since ? { gte: since } : {}),
              ...(until ? { lt: until } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: sort },
    take: limit,
    select: {
      id: true,
      userId: true,
      userMessage: true,
      errorKind: true,
      errorDetail: true,
      discoveryId: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
  });

  return errors.map((e) => ({
    id: e.id,
    userId: e.userId,
    userName: e.user.name,
    userEmail: e.user.email,
    userMessage: e.userMessage,
    errorKind: e.errorKind,
    errorDetail: e.errorDetail,
    discoveryId: e.discoveryId,
    createdAt: e.createdAt,
  }));
}
