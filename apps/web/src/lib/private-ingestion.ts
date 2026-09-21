import { randomUUID } from 'node:crypto';
import { Prisma, type EpisodeSource } from '@/generated/prisma/client';
import { admitDurableJob, contentExtractionQueue, JobType } from './queue';
import type { ExtractContentPayload } from './queue';
import { getProviderForModel } from './providers/ai-registry';
import { generateEpisodeSlug } from './slugify';

export type PrivateIngestionTransaction = Prisma.TransactionClient;

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
  authorize: (database: Prisma.TransactionClient) => Promise<{ userId?: string } | void>;
  writeIngestionRecord: (tx: PrivateIngestionTransaction, episodeId: string) => Promise<void>;
}

export async function createPrivateIngestionEpisode(
  params: CreatePrivateIngestionEpisodeParams
): Promise<{ id: string; status: string; source: EpisodeSource; discoveryId: string }> {
  const episodeId = randomUUID();
  const discoveryId = randomUUID();
  const payload: ExtractContentPayload = {
    episodeId,
    userId: params.userId,
    sourceText: params.discovery.sourceContent,
  };
  await admitDurableJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload, {
    priority: params.jobPriority,
    jobId: `${params.jobIdPrefix}-${episodeId}`,
    authorize: params.authorize,
    mutate: async (database, operationId) => {
      await database.episode.create({
        data: {
          id: episodeId,
          userId: params.userId,
          title: params.title,
          topic: params.topic,
          status: 'EXTRACTING',
          pipelineGeneration: operationId,
          source: params.source,
          sourcePlatform: params.sourcePlatform,
          visibility: 'PRIVATE',
          aiProvider: params.aiModel ? getProviderForModel(params.aiModel) : null,
          aiModel: params.aiModel ?? null,
          ttsProvider: params.ttsProvider,
          ttsModel: params.ttsModel ?? null,
        },
      });
      await database.discovery.create({
        data: {
          id: discoveryId,
          episodeId,
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
      await params.writeIngestionRecord(database, episodeId);
      const slug = await generateEpisodeSlug(params.title, params.userId, database);
      if (slug) await database.episode.update({ where: { id: episodeId }, data: { slug } });
    },
  });
  return { id: episodeId, status: 'EXTRACTING', source: params.source, discoveryId };
}
