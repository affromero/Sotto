import { Job } from 'bullmq';
import { Prisma } from '@/generated/prisma/client';
import { DeepResearchPayload, addJob, JobType, creativePlanningQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { buildResearchDossier, type BuildDossierParams } from '@/lib/research-agent';
import { invalidateEpisodeCache, publishEpisodeStatus } from '@/lib/redis';
import { logUsage } from '@/lib/usage-logger';
import { getAiKey } from '@/lib/byok';
import { resolveAiModelAndProvider, type AiProviderId } from '@/lib/providers/ai-registry';
import { logger } from '@/lib/logger';
import { logPipelineStageComplete } from '@/lib/pipeline-events';

export async function processDeepResearch(job: Job<DeepResearchPayload>): Promise<void> {
  const { episodeId, userId, discoveryId, useAdminCredits } = job.data;

  logger.info('Deep research starting', { episodeId });
  await job.updateProgress(5);

  // Idempotency: skip if dossier already exists
  const existingDossier = await prisma.researchDossier.findUnique({
    where: { episodeId },
    select: { id: true },
  });

  if (existingDossier) {
    logger.info('Research dossier already exists, skipping to planning', { episodeId });

    await prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'PLANNING' },
    });
    await invalidateEpisodeCache(episodeId);
    await publishEpisodeStatus(episodeId, { status: 'PLANNING' });

    await addJob(creativePlanningQueue, JobType.CREATIVE_PLANNING, {
      episodeId,
      userId,
      discoveryId,
      dossierId: existingDossier.id,
      useAdminCredits,
    }, { jobId: `plan-${episodeId}-${Date.now()}` });

    await job.updateProgress(100);
    return;
  }

  // Load discovery + episode metadata
  const [discovery, episode] = await Promise.all([
    prisma.discovery.findUniqueOrThrow({
      where: { id: discoveryId },
      select: {
        topic: true,
        depth: true,
        tone: true,
        audience: true,
        audienceLevel: true,
        durationTarget: true,
        focusAreas: true,
        sourceContent: true,
        sourceUrl: true,
        messages: { select: { role: true, content: true }, orderBy: { createdAt: 'asc' } },
      },
    }),
    prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      select: { source: true, aiProvider: true, aiModel: true },
    }),
  ]);

  await job.updateProgress(10);

  const aiKey = useAdminCredits || episode.aiModel ? null : await getAiKey(userId);
  if (!episode.aiModel && !aiKey) {
    throw new Error('AI model is required for deep research when no AI key is configured.');
  }

  // Resolve AI model
  const { model, provider } = await resolveAiModelAndProvider({
    episodeAiModel: episode.aiModel,
    aiKey,
  });

  const providerAiKey =
    episode.aiModel && provider !== 'claude-code' && !useAdminCredits
      ? await getAiKey(userId, provider as AiProviderId)
      : aiKey;
  if (episode.aiModel && provider !== 'claude-code' && !useAdminCredits && !providerAiKey) {
    throw new Error(`AI key for provider "${provider}" is required for deep research.`);
  }

  // Determine research mode
  const hasSourceContent = !!discovery.sourceContent;

  const mode: BuildDossierParams['mode'] = hasSourceContent ? 'source-bound' : 'open-web';

  // Extract discovery summary from chat messages
  const discoverySummary = discovery.messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join(' ')
    .slice(0, 2000);

  await job.updateProgress(20);

  // Build dossier
  const dossier = await buildResearchDossier({
    mode,
    topic: discovery.topic || '',
    depth: discovery.depth || 'standard',
    tone: discovery.tone || 'casual',
    audienceLevel: discovery.audienceLevel || 'general',
    durationTarget: discovery.durationTarget || 10,
    sourceContent: discovery.sourceContent ?? undefined,
    focusAreas: discovery.focusAreas || [],
    suppliedSourceUrls: discovery.sourceUrl ? [discovery.sourceUrl] : [],
    discoverySummary,
    apiKeyOverride: providerAiKey?.apiKey,
    model,
    provider,
  });

  await job.updateProgress(80);

  // Save dossier to DB
  const savedDossier = await prisma.researchDossier.create({
    data: {
      episodeId,
      mode: dossier.mode,
      userBrief: dossier.userBrief as unknown as Prisma.InputJsonValue,
      sources: dossier.sources as unknown as Prisma.InputJsonValue,
      evidence: dossier.evidence as unknown as Prisma.InputJsonValue,
      gaps: dossier.gaps,
      blockedClaims: dossier.blockedClaims,
      recommendedAngle: dossier.recommendedAngle,
      totalInputTokens: dossier.totalInputTokens,
      totalOutputTokens: dossier.totalOutputTokens,
      model: dossier.model,
    },
  });

  await job.updateProgress(90);

  // Log usage
  await logUsage({
    service: provider,
    model,
    category: 'research',
    inputTokens: dossier.totalInputTokens,
    outputTokens: dossier.totalOutputTokens,
    episodeId,
    userId,
  });

  await logPipelineStageComplete(episodeId, 'deep-research',
    `mode=${mode} sources=${dossier.sources.length} evidence=${dossier.evidence.length} gaps=${dossier.gaps.length}`,
  );

  // Chain to creative planning
  await prisma.episode.update({
    where: { id: episodeId },
    data: { status: 'PLANNING' },
  });
  await invalidateEpisodeCache(episodeId);
  await publishEpisodeStatus(episodeId, { status: 'PLANNING' });

  await addJob(creativePlanningQueue, JobType.CREATIVE_PLANNING, {
    episodeId,
    userId,
    discoveryId,
    dossierId: savedDossier.id,
    useAdminCredits,
  }, { jobId: `plan-${episodeId}-${Date.now()}` });

  logger.info('Deep research complete, queued creative planning', {
    episodeId,
    mode,
    sources: String(dossier.sources.length),
    evidence: String(dossier.evidence.length),
  });

  await job.updateProgress(100);
}
