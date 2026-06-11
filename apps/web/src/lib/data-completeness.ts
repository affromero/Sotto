import { prisma } from './prisma';

export interface CompletenessDimension {
  key: string;
  label: string;
  present: boolean;
}

export interface PodcastCompleteness {
  podcastId: string;
  title: string;
  score: number;
  maxScore: number;
  aiProvider: string | null;
  aiModel: string | null;
  ttsProvider: string | null;
  ttsModel: string | null;
  createdAt: Date;
  dimensions: CompletenessDimension[];
}

export interface CorpusDimensionCount {
  key: string;
  label: string;
  count: number;
  total: number;
}

export interface CompletenessInput {
  hasScript: boolean;
  hasAudio: boolean;
  segmentCount: number;
  segmentsWithAudio: number;
  referenceCount: number;
  verifiedReferenceCount: number;
  discoveryMessageCount: number;
  voiceAssignmentCount: number;
  tagCount: number;
  answeredInteractionCount: number;
  playbackSessionCount: number;
  hasMLFeatures: boolean;
  apiCostLogCount: number;
}

const DIMENSION_LABELS: Record<string, string> = {
  script: 'Script',
  audio: 'Audio',
  segments: 'Segments',
  references: 'References',
  verifiedReferences: 'Verified References',
  discoveryChat: 'Discovery Chat',
  voiceAssignments: 'Voice Assignments',
  tags: 'Tags',
  qaInteractions: 'Q&A Interactions',
  playbackData: 'Playback Data',
  mlFeatures: 'ML Features',
  apiCostLogs: 'API Cost Logs',
};

export function computeCompletenessChecklist(data: CompletenessInput): {
  score: number;
  maxScore: number;
  dimensions: CompletenessDimension[];
} {
  const dimensions: CompletenessDimension[] = [
    { key: 'script', label: DIMENSION_LABELS.script, present: data.hasScript },
    { key: 'audio', label: DIMENSION_LABELS.audio, present: data.hasAudio },
    { key: 'segments', label: DIMENSION_LABELS.segments, present: data.segmentCount > 0 && data.segmentsWithAudio === data.segmentCount },
    { key: 'references', label: DIMENSION_LABELS.references, present: data.referenceCount > 0 },
    { key: 'verifiedReferences', label: DIMENSION_LABELS.verifiedReferences, present: data.verifiedReferenceCount > 0 },
    { key: 'discoveryChat', label: DIMENSION_LABELS.discoveryChat, present: data.discoveryMessageCount > 0 },
    { key: 'voiceAssignments', label: DIMENSION_LABELS.voiceAssignments, present: data.voiceAssignmentCount > 0 },
    { key: 'tags', label: DIMENSION_LABELS.tags, present: data.tagCount > 0 },
    { key: 'qaInteractions', label: DIMENSION_LABELS.qaInteractions, present: data.answeredInteractionCount > 0 },
    { key: 'playbackData', label: DIMENSION_LABELS.playbackData, present: data.playbackSessionCount > 0 },
    { key: 'mlFeatures', label: DIMENSION_LABELS.mlFeatures, present: data.hasMLFeatures },
    { key: 'apiCostLogs', label: DIMENSION_LABELS.apiCostLogs, present: data.apiCostLogCount > 0 },
  ];

  const score = dimensions.filter((d) => d.present).length;
  return { score, maxScore: dimensions.length, dimensions };
}

export async function getCorpusCompleteness(): Promise<CorpusDimensionCount[]> {
  const totalReady = await prisma.podcast.count({
    where: { status: 'READY', deletedAt: null },
  });

  if (totalReady === 0) return [];

  const [
    withScript,
    withAudio,
    withAllSegmentAudio,
    withReferences,
    withVerifiedReferences,
    withDiscoveryMessages,
    withVoiceAssignments,
    withTags,
    withAnsweredInteractions,
    withPlaybackSessions,
    withMLFeatures,
    withApiCostLogs,
  ] = await Promise.all([
    // 1. Script
    prisma.script.count({
      where: { podcast: { status: 'READY', deletedAt: null } },
    }),
    // 2. Audio
    prisma.podcast.count({
      where: { status: 'READY', deletedAt: null, audioUrl: { not: null } },
    }),
    // 3. Segments (all with audio) — count podcasts that have segments and none missing audio
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT p.id)::bigint as count
      FROM "Podcast" p
      JOIN "Segment" s ON s."podcastId" = p.id
      WHERE p.status = 'READY' AND p."deletedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Segment" s2
        WHERE s2."podcastId" = p.id AND s2."audioUrl" IS NULL
      )
    `.then((r: { count: bigint }[]) => Number(r[0]?.count ?? 0)),
    // 4. References
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT "podcastId")::bigint as count
      FROM "Reference" r
      JOIN "Podcast" p ON p.id = r."podcastId"
      WHERE p.status = 'READY' AND p."deletedAt" IS NULL
    `.then((r: { count: bigint }[]) => Number(r[0]?.count ?? 0)),
    // 5. Verified References
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT "podcastId")::bigint as count
      FROM "Reference" r
      JOIN "Podcast" p ON p.id = r."podcastId"
      WHERE p.status = 'READY' AND p."deletedAt" IS NULL
      AND r."verificationStatus" = 'VERIFIED'
    `.then((r: { count: bigint }[]) => Number(r[0]?.count ?? 0)),
    // 6. Discovery Chat (with messages)
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT d."podcastId")::bigint as count
      FROM "Discovery" d
      JOIN "DiscoveryMessage" dm ON dm."discoveryId" = d.id
      JOIN "Podcast" p ON p.id = d."podcastId"
      WHERE p.status = 'READY' AND p."deletedAt" IS NULL
    `.then((r: { count: bigint }[]) => Number(r[0]?.count ?? 0)),
    // 7. Voice Assignments
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT "podcastId")::bigint as count
      FROM "PodcastVoice" pv
      JOIN "Podcast" p ON p.id = pv."podcastId"
      WHERE p.status = 'READY' AND p."deletedAt" IS NULL
    `.then((r: { count: bigint }[]) => Number(r[0]?.count ?? 0)),
    // 8. Tags
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT "podcastId")::bigint as count
      FROM "PodcastTag" pt
      JOIN "Podcast" p ON p.id = pt."podcastId"
      WHERE p.status = 'READY' AND p."deletedAt" IS NULL
    `.then((r: { count: bigint }[]) => Number(r[0]?.count ?? 0)),
    // 9. Q&A Interactions (answered+)
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT "podcastId")::bigint as count
      FROM "Interaction" i
      JOIN "Podcast" p ON p.id = i."podcastId"
      WHERE p.status = 'READY' AND p."deletedAt" IS NULL
      AND i.status IN ('ANSWERED', 'RESOLVED', 'INCORPORATING', 'INCORPORATED')
    `.then((r: { count: bigint }[]) => Number(r[0]?.count ?? 0)),
    // 10. Playback Data
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT "podcastId")::bigint as count
      FROM "PlaybackSession" ps
      JOIN "Podcast" p ON p.id = ps."podcastId"
      WHERE p.status = 'READY' AND p."deletedAt" IS NULL
    `.then((r: { count: bigint }[]) => Number(r[0]?.count ?? 0)),
    // 11. ML Features
    prisma.podcastFeature.count({
      where: { podcast: { status: 'READY', deletedAt: null } },
    }),
    // 12. API Cost Logs
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT "podcastId")::bigint as count
      FROM "ApiUsageLog" a
      JOIN "Podcast" p ON p.id = a."podcastId"
      WHERE p.status = 'READY' AND p."deletedAt" IS NULL
      AND a."podcastId" IS NOT NULL
    `.then((r: { count: bigint }[]) => Number(r[0]?.count ?? 0)),
  ]);

  // Use named map instead of positional array to prevent silent mismatch
  // if DIMENSION_LABELS is ever reordered
  const countsByKey: Record<string, number> = {
    script: withScript,
    audio: withAudio,
    segments: withAllSegmentAudio,
    references: withReferences,
    verifiedReferences: withVerifiedReferences,
    discoveryChat: withDiscoveryMessages,
    voiceAssignments: withVoiceAssignments,
    tags: withTags,
    qaInteractions: withAnsweredInteractions,
    playbackData: withPlaybackSessions,
    mlFeatures: withMLFeatures,
    apiCostLogs: withApiCostLogs,
  };

  return Object.entries(DIMENSION_LABELS).map(([key, label]) => ({
    key,
    label,
    count: countsByKey[key] ?? 0,
    total: totalReady,
  }));
}

export async function getPodcastCompletenessScores(
  page: number,
  perPage: number,
  sortBy: 'score' | 'date',
  sortDir: 'asc' | 'desc'
): Promise<{ podcasts: PodcastCompleteness[]; total: number }> {
  const safePage = Math.max(1, page);
  const safePerPage = Math.max(1, perPage);

  const total = await prisma.podcast.count({
    where: { status: 'READY', deletedAt: null },
  });

  const podcasts = await prisma.podcast.findMany({
    where: { status: 'READY', deletedAt: null },
    orderBy: sortBy === 'date' ? { createdAt: sortDir } : { createdAt: 'desc' },
    skip: (safePage - 1) * safePerPage,
    take: safePerPage,
    select: {
      id: true,
      title: true,
      aiProvider: true,
      aiModel: true,
      ttsProvider: true,
      ttsModel: true,
      createdAt: true,
      audioUrl: true,
      script: { select: { turns: true } },
      _count: {
        select: {
          segments: true,
          references: true,
          voices: true,
          tags: true,
          playbackSessions: true,
          pipelineEvents: true,
        },
      },
      interactions: { select: { status: true } },
      segments: { select: { audioUrl: true } },
      references: { select: { verificationStatus: true } },
      discovery: {
        select: {
          _count: { select: { messages: true } },
        },
      },
      podcastFeature: { select: { id: true } },
    },
  });

  // Batch fetch counts for dimensions that need cross-table joins
  const podcastIds = podcasts.map((p) => p.id);

  const apiLogCounts = await prisma.apiUsageLog.groupBy({
    by: ['podcastId'],
    where: { podcastId: { in: podcastIds } },
    _count: true,
  });

  const apiLogMap = new Map(apiLogCounts.map((r) => [r.podcastId, r._count]));

  const results: PodcastCompleteness[] = podcasts.map((p) => {
    const turns = Array.isArray(p.script?.turns) ? p.script.turns : [];
    const segmentsWithAudio = p.segments.filter((s) => s.audioUrl !== null).length;
    const verifiedRefs = p.references.filter((r) => r.verificationStatus === 'VERIFIED').length;
    const answeredStatuses = ['ANSWERED', 'RESOLVED', 'INCORPORATING', 'INCORPORATED'];
    const answeredInteractions = p.interactions.filter((i) => answeredStatuses.includes(i.status)).length;

    const input: CompletenessInput = {
      hasScript: turns.length > 0,
      hasAudio: p.audioUrl !== null,
      segmentCount: p._count.segments,
      segmentsWithAudio,
      referenceCount: p._count.references,
      verifiedReferenceCount: verifiedRefs,
      discoveryMessageCount: p.discovery?._count.messages ?? 0,
      voiceAssignmentCount: p._count.voices,
      tagCount: p._count.tags,
      answeredInteractionCount: answeredInteractions,
      playbackSessionCount: p._count.playbackSessions,
      hasMLFeatures: p.podcastFeature !== null,
      apiCostLogCount: apiLogMap.get(p.id) ?? 0,
    };

    const { score, maxScore, dimensions } = computeCompletenessChecklist(input);

    return {
      podcastId: p.id,
      title: p.title,
      score,
      maxScore,
      aiProvider: p.aiProvider,
      aiModel: p.aiModel,
      ttsProvider: p.ttsProvider,
      ttsModel: p.ttsModel,
      createdAt: p.createdAt,
      dimensions,
    };
  });

  // Sort by score if requested (can't do in Prisma since it's computed)
  if (sortBy === 'score') {
    results.sort((a, b) =>
      sortDir === 'desc' ? b.score - a.score : a.score - b.score
    );
  }

  return { podcasts: results, total };
}
