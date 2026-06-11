/**
 * BYOK conversion funnel and pipeline health queries for the admin dashboard.
 */

import { PodcastStatus } from '@prisma/client';
import { prisma } from './prisma';

export interface ByokAdoptionFunnel {
  generatingUsers: number;
  byokUsers: number;
  byokConversionRate: number;
}

export async function getByokAdoptionFunnel(): Promise<ByokAdoptionFunnel> {
  const [generatingUsers, byokRows] = await Promise.all([
    prisma.user.count({
      where: { podcasts: { some: {} } },
    }),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT ak."userId")::bigint AS count
      FROM "UserAiKey" ak
      JOIN "UserTtsKey" tk ON tk."userId" = ak."userId"
      WHERE ak."isValid" = true AND tk."isValid" = true
    `,
  ]);

  const byokUsers = Number(byokRows[0]?.count ?? 0);
  const byokConversionRate = generatingUsers > 0 ? byokUsers / generatingUsers : 0;

  return {
    generatingUsers,
    byokUsers,
    byokConversionRate,
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
      SELECT AVG(EXTRACT(EPOCH FROM (pe."createdAt" - p."createdAt")))::float AS avg
      FROM "Podcast" p
      JOIN "PipelineEvent" pe ON pe."podcastId" = p."id"
        AND pe."type" = 'complete'
        AND pe."stage" = 'audio-stitching'
      WHERE p."status" = 'READY'
        AND p."deletedAt" IS NULL
        AND p."source" != 'IMPORT'
        AND p."createdAt" >= ${since}
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

// ── In-Progress Pipelines ─────────────────────────────────────────

const IN_PROGRESS_STATUSES: PodcastStatus[] = [
  PodcastStatus.PENDING,
  PodcastStatus.DISCOVERING,
  PodcastStatus.EXTRACTING,
  PodcastStatus.RESEARCHING,
  PodcastStatus.PLANNING,
  PodcastStatus.SCRIPTING,
  PodcastStatus.COMPILING,
  PodcastStatus.GENERATING_AUDIO,
  PodcastStatus.STITCHING,
  PodcastStatus.UPDATING,
  PodcastStatus.IMPORTING,
  PodcastStatus.TRANSCRIBING,
];

export interface InProgressPipeline {
  id: string;
  title: string;
  status: PodcastStatus;
  userName: string | null;
  userEmail: string | null;
  createdAt: Date;
  elapsedSeconds: number;
}

export async function getInProgressPipelines(limit = 20): Promise<InProgressPipeline[]> {
  const now = new Date();
  const rows = await prisma.podcast.findMany({
    where: {
      status: { in: IN_PROGRESS_STATUSES },
      deletedAt: null,
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    userName: r.user.name,
    userEmail: r.user.email,
    createdAt: r.createdAt,
    elapsedSeconds: Math.floor((now.getTime() - r.createdAt.getTime()) / 1000),
  }));
}

// ── Recently Succeeded ────────────────────────────────────────────

export interface RecentlySucceeded {
  id: string;
  podcastId: string;
  podcastTitle: string;
  userName: string | null;
  userEmail: string | null;
  podcastCreatedAt: Date;
  completedAt: Date;
  generationSeconds: number;
}

export async function getRecentlySucceeded(
  since: Date,
  until?: Date,
  limit = 20,
): Promise<RecentlySucceeded[]> {
  const rows = await prisma.pipelineEvent.findMany({
    where: {
      type: 'complete',
      stage: 'audio-stitching',
      createdAt: { gte: since, ...(until ? { lt: until } : {}) },
      podcast: {
        status: PodcastStatus.READY,
        source: { not: 'IMPORT' },
        deletedAt: null,
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      podcast: {
        select: {
          id: true,
          title: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    podcastId: r.podcast.id,
    podcastTitle: r.podcast.title,
    userName: r.podcast.user.name,
    userEmail: r.podcast.user.email,
    podcastCreatedAt: r.podcast.createdAt,
    completedAt: r.createdAt,
    generationSeconds: Math.floor(
      (r.createdAt.getTime() - r.podcast.createdAt.getTime()) / 1000,
    ),
  }));
}

// ── Per-Stage Timing ─────────────────────────────────────────────

export interface StageTiming {
  stage: string;
  avgSeconds: number;
  p50Seconds: number;
  p95Seconds: number;
  count: number;
}

/**
 * Compute per-stage timing from consecutive 'complete' PipelineEvents.
 * Uses SQL LAG() window function to find the gap between each stage completion
 * and the previous one (or Podcast.createdAt for the first stage).
 */
export async function getPerStageTiming(since: Date): Promise<StageTiming[]> {
  const rows = await prisma.$queryRaw<StageTiming[]>`
    WITH ordered AS (
      SELECT
        pe."stage",
        EXTRACT(EPOCH FROM (
          pe."createdAt" - COALESCE(
            LAG(pe."createdAt") OVER (PARTITION BY pe."podcastId" ORDER BY pe."createdAt"),
            p."createdAt"
          )
        )) AS duration_seconds
      FROM "PipelineEvent" pe
      JOIN "Podcast" p ON p."id" = pe."podcastId"
      WHERE pe."type" = 'complete'
        AND p."deletedAt" IS NULL
        AND p."source" != 'IMPORT'
        AND p."createdAt" >= ${since}
    )
    SELECT
      stage AS "stage",
      AVG(duration_seconds)::float AS "avgSeconds",
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_seconds)::float AS "p50Seconds",
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_seconds)::float AS "p95Seconds",
      COUNT(*)::int AS "count"
    FROM ordered
    GROUP BY stage
    ORDER BY MIN(duration_seconds)
  `;

  return rows;
}

// ── Script Review Pause Metrics ─────────────────────────────────────

export interface ScriptReviewPauseMetrics {
  totalCreated: number;
  pausedAtScriptReady: number;
  pauseRate: number;
}

export async function getScriptReviewPauseMetrics(
  since: Date,
  until?: Date,
): Promise<ScriptReviewPauseMetrics> {
  const dateFilter = { gte: since, ...(until ? { lt: until } : {}) };

  const [totalCreated, pausedAtScriptReady] = await Promise.all([
    prisma.podcast.count({
      where: { createdAt: dateFilter, source: { not: 'IMPORT' } },
    }),
    prisma.podcast.count({
      where: {
        createdAt: dateFilter,
        status: PodcastStatus.SCRIPT_READY,
        source: { not: 'IMPORT' },
        deletedAt: null,
      },
    }),
  ]);

  return {
    totalCreated,
    pausedAtScriptReady,
    pauseRate: totalCreated > 0 ? pausedAtScriptReady / totalCreated : 0,
  };
}
