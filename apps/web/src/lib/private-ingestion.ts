import { Prisma, type PodcastSource } from '@prisma/client';
import { prisma } from './prisma';
import { addJob, contentExtractionQueue, JobType } from './queue';
import type { ExtractContentPayload } from './queue';
import { getProviderForModel } from './providers/ai-registry';
import { generatePodcastSlug } from './slugify';

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

interface CreatePrivateIngestionPodcastParams {
  userId: string;
  title: string;
  topic: string;
  source: PodcastSource;
  sourcePlatform: string;
  aiModel?: string;
  ttsProvider: string;
  ttsModel?: string;
  discovery: PrivateIngestionDiscovery;
  jobPriority: number;
  jobIdPrefix: string;
  writeIngestionRecord: (
    tx: PrivateIngestionTransaction,
    podcastId: string
  ) => Promise<void>;
}

function resolveAiProvider(aiModel?: string): string | null {
  if (!aiModel) return null;
  if (aiModel.startsWith('claude-code:')) return 'claude-code';
  return getProviderForModel(aiModel);
}

export async function createPrivateIngestionPodcast(
  params: CreatePrivateIngestionPodcastParams
): Promise<{ id: string; status: string; source: PodcastSource; discoveryId: string }> {
  const created = await prisma.$transaction(async (tx) => {
    const podcast = await tx.podcast.create({
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
        podcastId: podcast.id,
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

    await params.writeIngestionRecord(tx, podcast.id);

    return { podcast, discovery };
  });

  const slug = await generatePodcastSlug(params.title, params.userId, prisma);
  if (slug) {
    await prisma.podcast.update({ where: { id: created.podcast.id }, data: { slug } });
  }

  const payload: ExtractContentPayload = {
    podcastId: created.podcast.id,
    userId: params.userId,
    sourceText: params.discovery.sourceContent,
  };
  await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload, {
    priority: params.jobPriority,
    jobId: `${params.jobIdPrefix}-${created.podcast.id}`,
  });

  return {
    id: created.podcast.id,
    status: created.podcast.status,
    source: params.source,
    discoveryId: created.discovery.id,
  };
}
