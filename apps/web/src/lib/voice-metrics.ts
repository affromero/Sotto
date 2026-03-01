import { prisma } from './prisma';

export interface VoiceUsageRow {
  provider: string;
  voiceId: string;
  podcastCount: number;
}

export interface VoiceProviderSummary {
  provider: string;
  uniqueVoices: number;
  totalAssignments: number;
}

export async function getVoiceUsageByProvider(since: Date): Promise<VoiceProviderSummary[]> {
  const rows = await prisma.$queryRaw<
    Array<{ provider: string; uniqueVoices: bigint; totalAssignments: bigint }>
  >`
    SELECT
      pv.provider,
      COUNT(DISTINCT pv."voiceId")::bigint AS "uniqueVoices",
      COUNT(*)::bigint AS "totalAssignments"
    FROM "PodcastVoice" pv
    JOIN "Podcast" p ON pv."podcastId" = p.id
    WHERE pv.provider IS NOT NULL
      AND p."createdAt" >= ${since}
      AND p."deletedAt" IS NULL
    GROUP BY pv.provider
    ORDER BY "totalAssignments" DESC
  `;

  return rows.map((r) => ({
    provider: r.provider,
    uniqueVoices: Number(r.uniqueVoices),
    totalAssignments: Number(r.totalAssignments),
  }));
}

export async function getTopVoices(since: Date, limit = 20): Promise<VoiceUsageRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{ provider: string; voiceId: string; podcastCount: bigint }>
  >`
    SELECT
      pv.provider,
      pv."voiceId",
      COUNT(DISTINCT pv."podcastId")::bigint AS "podcastCount"
    FROM "PodcastVoice" pv
    JOIN "Podcast" p ON pv."podcastId" = p.id
    WHERE pv.provider IS NOT NULL
      AND pv."voiceId" IS NOT NULL
      AND p."createdAt" >= ${since}
      AND p."deletedAt" IS NULL
    GROUP BY pv.provider, pv."voiceId"
    ORDER BY "podcastCount" DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    provider: r.provider,
    voiceId: r.voiceId,
    podcastCount: Number(r.podcastCount),
  }));
}
