import { Job } from 'bullmq';
import { Prisma } from '@/generated/prisma/client';
import { CreativePlanningPayload, addJob, JobType, scriptWritingQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { createCreativeOutline } from '@/lib/creative-director';
import type { SourceRecord, EvidenceCard } from '@/lib/research-agent';
import { invalidateEpisodeCache, publishEpisodeStatus } from '@/lib/redis';
import { logUsage } from '@/lib/usage-logger';
import { getAiKey } from '@/lib/byok';
import {
  providerRequiresAiKey,
  resolveAiModelAndProvider,
  type AiProviderId,
} from '@/lib/providers/ai-registry';
import { logger } from '@/lib/logger';
import { logPipelineStageComplete } from '@/lib/pipeline-events';

export async function processCreativePlanning(job: Job<CreativePlanningPayload>): Promise<void> {
  const { episodeId, userId, discoveryId, dossierId, useAdminCredits } = job.data;

  logger.info('Creative planning starting', { episodeId });
  await job.updateProgress(5);

  // Idempotency: skip if outline already exists
  const existingOutline = await prisma.creativeOutline.findUnique({
    where: { episodeId },
    select: { id: true },
  });

  if (existingOutline) {
    logger.info('Creative outline already exists, skipping to script writing', { episodeId });

    await prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'SCRIPTING' },
    });
    await invalidateEpisodeCache(episodeId);
    await publishEpisodeStatus(episodeId, { status: 'SCRIPTING' });

    await addJob(
      scriptWritingQueue,
      JobType.WRITE_SCRIPT,
      {
        episodeId,
        userId,
        discoveryId,
        dossierId,
        outlineId: existingOutline.id,
        useAdminCredits,
      },
      { jobId: `write-${episodeId}-${String(job.id)}` }
    );

    await job.updateProgress(100);
    return;
  }

  // Load dossier + discovery metadata
  const [dossier, discovery, episode] = await Promise.all([
    prisma.researchDossier.findUniqueOrThrow({
      where: { id: dossierId },
      select: { sources: true, evidence: true, recommendedAngle: true },
    }),
    prisma.discovery.findUniqueOrThrow({
      where: { id: discoveryId },
      select: {
        topic: true,
        depth: true,
        tone: true,
        audience: true,
        audienceLevel: true,
        durationTarget: true,
        speakers: true,
      },
    }),
    prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      select: { aiModel: true },
    }),
  ]);

  await job.updateProgress(15);

  const aiKey = useAdminCredits || episode.aiModel ? null : await getAiKey(userId);
  if (!episode.aiModel && !aiKey) {
    throw new Error('AI model is required for creative planning when no AI key is configured.');
  }

  const { model, provider } = await resolveAiModelAndProvider({
    episodeAiModel: episode.aiModel,
    aiKey,
  });

  const providerAiKey =
    episode.aiModel && providerRequiresAiKey(provider) && !useAdminCredits
      ? await getAiKey(userId, provider as AiProviderId)
      : aiKey;
  if (episode.aiModel && providerRequiresAiKey(provider) && !useAdminCredits && !providerAiKey) {
    throw new Error(`AI key for provider "${provider}" is required for creative planning.`);
  }

  const sources = dossier.sources as unknown as SourceRecord[];
  const evidence = dossier.evidence as unknown as EvidenceCard[];

  const speakers = (discovery.speakers as Array<{ name: string; description: string }>) || [
    { name: 'Host', description: 'Curious and engaging narrator' },
    { name: 'Expert', description: 'Knowledgeable authority on the topic' },
  ];

  // Build outline
  const outline = await createCreativeOutline({
    topic: discovery.topic || '',
    depth: discovery.depth || 'standard',
    tone: discovery.tone || 'casual',
    audience: discovery.audience || 'general',
    audienceLevel: discovery.audienceLevel || 'general',
    durationTarget: discovery.durationTarget || 10,
    speakers,
    sources,
    evidence,
    recommendedAngle: dossier.recommendedAngle,
    apiKeyOverride: providerAiKey?.apiKey,
    model,
    provider,
  });

  await job.updateProgress(80);

  // Save outline to DB
  const savedOutline = await prisma.creativeOutline.create({
    data: {
      episodeId,
      drivingQuestion: outline.drivingQuestion,
      listenerPromise: outline.listenerPromise,
      thesis: outline.thesis,
      narrativeFramework: outline.narrativeFramework,
      hook: outline.beats.find((b) => b.purpose === 'hook')?.summary || '',
      beats: outline.beats as unknown as Prisma.InputJsonValue,
      tensionCurve: outline.tensionCurve as unknown as Prisma.InputJsonValue,
      bannedAngles: outline.bannedAngles,
      unresolvedQuestions: outline.unresolvedQuestions,
      speakerRoles: outline.speakerRoles as unknown as Prisma.InputJsonValue,
      inputTokens: outline.inputTokens,
      outputTokens: outline.outputTokens,
      model: outline.model,
    },
  });

  await job.updateProgress(90);

  await logUsage({
    service: provider,
    model,
    category: 'planning',
    inputTokens: outline.inputTokens,
    outputTokens: outline.outputTokens,
    episodeId,
    userId,
  });

  await logPipelineStageComplete(
    episodeId,
    'creative-planning',
    `framework=${outline.narrativeFramework} beats=${outline.beats.length}`
  );

  // Chain to script writing
  await prisma.episode.update({
    where: { id: episodeId },
    data: { status: 'SCRIPTING' },
  });
  await invalidateEpisodeCache(episodeId);
  await publishEpisodeStatus(episodeId, { status: 'SCRIPTING' });

  await addJob(
    scriptWritingQueue,
    JobType.WRITE_SCRIPT,
    {
      episodeId,
      userId,
      discoveryId,
      dossierId,
      outlineId: savedOutline.id,
      useAdminCredits,
    },
    { jobId: `write-${episodeId}-${String(job.id)}` }
  );

  logger.info('Creative planning complete, queued script writing', {
    episodeId,
    framework: outline.narrativeFramework,
    beats: String(outline.beats.length),
  });

  await job.updateProgress(100);
}
