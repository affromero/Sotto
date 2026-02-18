/**
 * BYOK conversion funnel and pipeline health queries for the admin dashboard.
 */

import { prisma } from './prisma';

export interface FreeTierFunnel {
  freeGenUsers: number;
  exhaustedUsers: number;
  byokUsers: number;
  conversionRate: number;
}

export async function getFreeTierFunnel(): Promise<FreeTierFunnel> {
  const [freeGenUsers, exhaustedRows, byokRows] = await Promise.all([
    prisma.user.count({ where: { freeGenerationsUsed: { gt: 0 } } }),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM "User" u
      CROSS JOIN "FreeTierConfig" f
      WHERE f."id" = 'singleton'
        AND u."freeGenerationsUsed" >= f."generationLimit"
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT ak."userId")::bigint AS count
      FROM "UserAiKey" ak
      JOIN "UserTtsKey" tk ON tk."userId" = ak."userId"
      WHERE ak."isValid" = true AND tk."isValid" = true
    `,
  ]);

  const exhaustedUsers = Number(exhaustedRows[0]?.count ?? 0);
  const byokUsers = Number(byokRows[0]?.count ?? 0);
  const conversionRate = exhaustedUsers > 0 ? byokUsers / exhaustedUsers : 0;

  return {
    freeGenUsers,
    exhaustedUsers,
    byokUsers,
    conversionRate,
  };
}

export interface ByokAdoption {
  ai: Array<{ provider: string; count: number }>;
  tts: Array<{ provider: string; count: number }>;
}

export async function getByokAdoption(): Promise<ByokAdoption> {
  const [aiGroups, ttsGroups] = await Promise.all([
    prisma.userAiKey.groupBy({
      by: ['provider'],
      where: { isValid: true },
      _count: true,
    }),
    prisma.userTtsKey.groupBy({
      by: ['provider'],
      where: { isValid: true },
      _count: true,
    }),
  ]);

  return {
    ai: aiGroups.map((g) => ({ provider: g.provider, count: g._count })),
    tts: ttsGroups.map((g) => ({ provider: g.provider, count: g._count })),
  };
}

export interface PipelineHealth {
  totalAttempted: number;
  totalFailed: number;
  failureRate: number;
  avgTimeToReadySeconds: number | null;
  failedAtStage: Array<{ stage: string; count: number }>;
}

export async function getPipelineHealth(since: Date): Promise<PipelineHealth> {
  const [totalAttempted, totalFailed, failedAtStage, avgTime] = await Promise.all([
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
  ]);

  return {
    totalAttempted,
    totalFailed,
    failureRate: totalAttempted > 0 ? totalFailed / totalAttempted : 0,
    avgTimeToReadySeconds: avgTime[0]?.avg ?? null,
    failedAtStage: failedAtStage.map((g) => ({
      stage: g.failedAtStatus ?? 'unknown',
      count: g._count,
    })),
  };
}
