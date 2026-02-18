/**
 * Engagement aggregation queries for the admin dashboard.
 * Extracted from traffic-report.ts for reuse.
 */

import { prisma } from './prisma';

export interface EngagementOverview {
  likes: number;
  saves: number;
  comments: number;
  forks: number;
  follows: number;
}

export async function getEngagementOverview(since: Date): Promise<EngagementOverview> {
  const [likes, saves, comments, forks, follows] = await Promise.all([
    prisma.like.count({ where: { createdAt: { gte: since } } }),
    prisma.save.count({ where: { createdAt: { gte: since } } }),
    prisma.comment.count({ where: { createdAt: { gte: since } } }),
    prisma.podcast.count({ where: { createdAt: { gte: since }, forkedFromId: { not: null } } }),
    prisma.follow.count({ where: { createdAt: { gte: since } } }),
  ]);

  return { likes, saves, comments, forks, follows };
}

export async function getDailyEngagementTrend(
  since: Date
): Promise<Array<{ day: string; likes: number; saves: number; comments: number; forks: number }>> {
  const rows = await prisma.$queryRaw<
    Array<{ day: Date; likes: bigint; saves: bigint; comments: bigint; forks: bigint }>
  >`
    WITH days AS (
      SELECT generate_series(${since}::date, NOW()::date, '1 day'::interval)::date AS day
    )
    SELECT
      d.day,
      COALESCE((SELECT COUNT(*) FROM "Like" WHERE "createdAt"::date = d.day AND "createdAt" >= ${since}), 0)::bigint AS likes,
      COALESCE((SELECT COUNT(*) FROM "Save" WHERE "createdAt"::date = d.day AND "createdAt" >= ${since}), 0)::bigint AS saves,
      COALESCE((SELECT COUNT(*) FROM "Comment" WHERE "createdAt"::date = d.day AND "createdAt" >= ${since}), 0)::bigint AS comments,
      COALESCE((SELECT COUNT(*) FROM "Podcast" WHERE "forkedFromId" IS NOT NULL AND "deletedAt" IS NULL AND "createdAt"::date = d.day AND "createdAt" >= ${since}), 0)::bigint AS forks
    FROM days d
    ORDER BY d.day ASC
  `;

  return rows.map((r) => ({
    day: r.day.toISOString().split('T')[0],
    likes: Number(r.likes),
    saves: Number(r.saves),
    comments: Number(r.comments),
    forks: Number(r.forks),
  }));
}

export interface TopContent {
  id: string;
  title: string | null;
  ownerName: string | null;
  ownerHandle: string | null;
  count: number;
}

export async function getTopLiked(limit: number = 10): Promise<TopContent[]> {
  const rows = await prisma.podcast.findMany({
    where: { likeCount: { gt: 0 } },
    orderBy: { likeCount: 'desc' },
    take: limit,
    select: { id: true, title: true, likeCount: true, user: { select: { name: true, handle: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    ownerName: r.user.name,
    ownerHandle: r.user.handle,
    count: r.likeCount,
  }));
}

export async function getTopForked(limit: number = 10): Promise<TopContent[]> {
  const rows = await prisma.podcast.findMany({
    where: { forkCount: { gt: 0 } },
    orderBy: { forkCount: 'desc' },
    take: limit,
    select: { id: true, title: true, forkCount: true, user: { select: { name: true, handle: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    ownerName: r.user.name,
    ownerHandle: r.user.handle,
    count: r.forkCount,
  }));
}

export async function getTopCommented(limit: number = 10): Promise<TopContent[]> {
  const rows = await prisma.podcast.findMany({
    where: { commentCount: { gt: 0 } },
    orderBy: { commentCount: 'desc' },
    take: limit,
    select: { id: true, title: true, commentCount: true, user: { select: { name: true, handle: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    ownerName: r.user.name,
    ownerHandle: r.user.handle,
    count: r.commentCount,
  }));
}

export interface InteractionStats {
  totalQuestions: number;
  answeredCount: number;
  incorporatedCount: number;
  helpfulCount: number;
  unhelpfulCount: number;
}

export async function getInteractionStats(since: Date): Promise<InteractionStats> {
  const [total, statusGroups, helpfulGroups] = await Promise.all([
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
  ]);

  const answeredCount = statusGroups
    .filter((g) => g.status === 'ANSWERED' || g.status === 'INCORPORATED' || g.status === 'RESOLVED')
    .reduce((sum, g) => sum + g._count, 0);
  const incorporatedCount = statusGroups
    .filter((g) => g.status === 'INCORPORATED')
    .reduce((sum, g) => sum + g._count, 0);
  const helpfulCount = helpfulGroups
    .filter((g) => g.helpful === true)
    .reduce((sum, g) => sum + g._count, 0);
  const unhelpfulCount = helpfulGroups
    .filter((g) => g.helpful === false)
    .reduce((sum, g) => sum + g._count, 0);

  return {
    totalQuestions: total,
    answeredCount,
    incorporatedCount,
    helpfulCount,
    unhelpfulCount,
  };
}
