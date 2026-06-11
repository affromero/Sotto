/**
 * Private activity aggregation queries for the admin dashboard.
 */

import { prisma } from './prisma';

export interface PrivateActivityOverview {
  saves: number;
  questions: number;
  answered: number;
  incorporated: number;
}

export interface DailyPrivateActivity {
  day: string;
  saves: number;
  questions: number;
}

export interface TopContent {
  id: string;
  title: string | null;
  ownerName: string | null;
  ownerHandle: string | null;
  count: number;
}

export interface InteractionStats {
  totalQuestions: number;
  answeredCount: number;
  incorporatedCount: number;
  helpfulCount: number;
  unhelpfulCount: number;
}

export async function getPrivateActivityOverview(since: Date): Promise<PrivateActivityOverview> {
  const [saves, questions, answered, incorporated] = await Promise.all([
    prisma.save.count({ where: { createdAt: { gte: since } } }),
    prisma.interaction.count({ where: { createdAt: { gte: since } } }),
    prisma.interaction.count({
      where: {
        createdAt: { gte: since },
        status: { in: ['ANSWERED', 'INCORPORATED', 'RESOLVED'] },
      },
    }),
    prisma.interaction.count({ where: { createdAt: { gte: since }, incorporated: true } }),
  ]);

  return { saves, questions, answered, incorporated };
}

export async function getDailyPrivateActivityTrend(since: Date): Promise<DailyPrivateActivity[]> {
  const rows = await prisma.$queryRaw<
    Array<{ day: Date; saves: bigint; questions: bigint }>
  >`
    WITH days AS (
      SELECT generate_series(${since}::date, NOW()::date, '1 day'::interval)::date AS day
    )
      SELECT
        d.day,
        COALESCE((SELECT COUNT(*) FROM "Save" WHERE "createdAt"::date = d.day AND "createdAt" >= ${since}), 0)::bigint AS saves,
        COALESCE((SELECT COUNT(*) FROM "Interaction" WHERE "createdAt"::date = d.day AND "createdAt" >= ${since}), 0)::bigint AS questions
    FROM days d
    ORDER BY d.day ASC
  `;

  return rows.map((r) => ({
    day: r.day.toISOString().split('T')[0],
    saves: Number(r.saves),
    questions: Number(r.questions),
  }));
}

export async function getTopSaved(limit: number = 10): Promise<TopContent[]> {
  const rows = await prisma.podcast.findMany({
    where: { deletedAt: null, saveCount: { gt: 0 } },
    orderBy: { saveCount: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      saveCount: true,
      user: { select: { name: true, handle: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    ownerName: r.user.name,
    ownerHandle: r.user.handle,
    count: r.saveCount,
  }));
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
    .filter(
      (g) => g.status === 'ANSWERED' || g.status === 'INCORPORATED' || g.status === 'RESOLVED'
    )
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
