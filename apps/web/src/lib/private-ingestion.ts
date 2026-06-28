import { Prisma, type EpisodeSource } from '@/generated/prisma/client';
import { prisma } from './prisma';
import { addJob, contentExtractionQueue, JobType } from './queue';
import type { ExtractContentPayload } from './queue';
import { getProviderForModel } from './providers/ai-registry';
import { generateEpisodeSlug } from './slugify';

export type PrivateIngestionTransaction = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

interface PrivateIngestionDiscovery {
  sourceContent: string;
  sourceMetadata: Prisma.InputJsonValue;
  sourceUrl?: string;
  depth?: string;
  audienceLevel?: string;
  focusAreas?: string[];
  tone?: string;
  durationTarget?: number;
}

interface CreatePrivateIngestionEpisodeParams {
  userId: string;
  title: string;
  topic: string;
  source: EpisodeSource;
  sourcePlatform: string;
  aiModel?: string;
  ttsProvider: string;
  ttsModel?: string;
  discovery: PrivateIngestionDiscovery;
  jobPriority: number;
  jobIdPrefix: string;
  writeIngestionRecord: (tx: PrivateIngestionTransaction, episodeId: string) => Promise<void>;
}

function resolveAiProvider(aiModel?: string): string | null {
  if (!aiModel) return null;
  return getProviderForModel(aiModel);
}

export async function createPrivateIngestionEpisode(
  params: CreatePrivateIngestionEpisodeParams
): Promise<{ id: string; status: string; source: EpisodeSource; discoveryId: string }> {
  const created = await prisma.$transaction(async (tx) => {
    const episode = await tx.episode.create({
      data: {
        userId: params.userId,
        title: params.title,
        topic: params.topic,
        status: 'EXTRACTING',
        source: params.source,
        sourcePlatform: params.sourcePlatform,
        visibility: 'PRIVATE',
        aiProvider: resolveAiProvider(params.aiModel),
        aiModel: params.aiModel ?? null,
        ttsProvider: params.ttsProvider,
        ttsModel: params.ttsModel ?? null,
      },
    });

    const discovery = await tx.discovery.create({
      data: {
        episodeId: episode.id,
        userId: params.userId,
        topic: params.topic,
        depth: params.discovery.depth ?? 'standard',
        audienceLevel: params.discovery.audienceLevel ?? 'general',
        focusAreas: params.discovery.focusAreas ?? [],
        tone: params.discovery.tone ?? 'casual',
        durationTarget: params.discovery.durationTarget ?? 10,
        sourceUrl: params.discovery.sourceUrl,
        sourceContent: params.discovery.sourceContent,
        sourceMetadata: params.discovery.sourceMetadata,
      },
    });

    await params.writeIngestionRecord(tx, episode.id);

    return { episode, discovery };
  });

  const slug = await generateEpisodeSlug(params.title, params.userId, prisma);
  if (slug) {
    await prisma.episode.update({ where: { id: created.episode.id }, data: { slug } });
  }

  const payload: ExtractContentPayload = {
    episodeId: created.episode.id,
    userId: params.userId,
    sourceText: params.discovery.sourceContent,
  };
  await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload, {
    priority: params.jobPriority,
    jobId: `${params.jobIdPrefix}-${created.episode.id}`,
  });

  return {
    id: created.episode.id,
    status: created.episode.status,
    source: params.source,
    discoveryId: created.discovery.id,
  };
}
