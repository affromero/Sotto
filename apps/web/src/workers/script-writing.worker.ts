import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { WriteScriptPayload, addJob, JobType, compileScriptQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { writeScript } from '@/lib/script-writer';
import type { SourceRecord, EvidenceCard } from '@/lib/research-agent';
import type { Beat } from '@/lib/creative-director';
import { invalidatePodcastCache, publishPodcastStatus } from '@/lib/redis';
import { logUsage } from '@/lib/usage-logger';
import { getAiKey } from '@/lib/byok';
import { getCheapestModelForProvider, resolveAiModelAndProvider, type AiProviderId } from '@/lib/providers/ai-registry';
import { detectLanguage } from '@/lib/language-detect';
import { matchTopicTags, TAG_PARENT_MAP } from '@/lib/topic-tagger';
import { logger } from '@/lib/logger';
import { logPipelineStageComplete } from '@/lib/pipeline-events';

export async function processScriptWriting(job: Job<WriteScriptPayload>): Promise<void> {
  const { podcastId, userId, discoveryId, dossierId, outlineId, useAdminCredits } = job.data;

  logger.info('Script writing starting', { podcastId });
  await job.updateProgress(5);

  // Idempotency: skip if script already exists
  const existingScript = await prisma.script.findUnique({
    where: { podcastId },
    select: { id: true },
  });

  if (existingScript) {
    logger.info('Script already exists, skipping to compile', { podcastId });

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'COMPILING' },
    });
    await invalidatePodcastCache(podcastId);
    await publishPodcastStatus(podcastId, { status: 'COMPILING' });

    await addJob(compileScriptQueue, JobType.COMPILE_SCRIPT, {
      podcastId,
      userId,
    }, { jobId: `compile-${podcastId}-${Date.now()}` });

    await job.updateProgress(100);
    return;
  }

  // Load dossier, outline, discovery, podcast
  const [dossier, outline, discovery, podcast] = await Promise.all([
    prisma.researchDossier.findUniqueOrThrow({
      where: { id: dossierId },
      select: { sources: true, evidence: true },
    }),
    prisma.creativeOutline.findUniqueOrThrow({
      where: { id: outlineId },
      select: { drivingQuestion: true, listenerPromise: true, thesis: true, beats: true },
    }),
    prisma.discovery.findUniqueOrThrow({
      where: { id: discoveryId },
      select: {
        topic: true, depth: true, tone: true, audience: true,
        audienceLevel: true, durationTarget: true, speakers: true,
      },
    }),
    prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: { aiModel: true },
    }),
  ]);

  await job.updateProgress(15);

  const aiKey = useAdminCredits || podcast.aiModel ? null : await getAiKey(userId);
  if (!podcast.aiModel && !aiKey) {
    throw new Error('AI model is required for script writing when no AI key is configured.');
  }

  const { model, provider } = await resolveAiModelAndProvider({
    podcastAiModel: podcast.aiModel,
    aiKey,
  });

  const providerAiKey =
    podcast.aiModel && provider !== 'claude-code' && !useAdminCredits
      ? await getAiKey(userId, provider as AiProviderId)
      : aiKey;
  if (podcast.aiModel && provider !== 'claude-code' && !useAdminCredits && !providerAiKey) {
    throw new Error(`AI key for provider "${provider}" is required for script writing.`);
  }

  const speakers = (discovery.speakers as Array<{ name: string; description: string }>) || [
    { name: 'Host', description: 'Curious and engaging podcast host' },
    { name: 'Expert', description: 'Knowledgeable authority on the topic' },
  ];

  // Write script
  const result = await writeScript({
    topic: discovery.topic || '',
    depth: discovery.depth || 'standard',
    tone: discovery.tone || 'casual',
    audience: discovery.audience || 'general',
    audienceLevel: discovery.audienceLevel || 'general',
    durationTarget: discovery.durationTarget || 10,
    speakers,
    dossier: {
      sources: dossier.sources as unknown as SourceRecord[],
      evidence: dossier.evidence as unknown as EvidenceCard[],
    },
    outline: {
      drivingQuestion: outline.drivingQuestion,
      listenerPromise: outline.listenerPromise,
      thesis: outline.thesis,
      beats: outline.beats as unknown as Beat[],
    },
    apiKeyOverride: providerAiKey?.apiKey,
    model,
    provider,
  });

  await job.updateProgress(70);

  // Save script to DB
  await prisma.script.create({
    data: {
      podcastId,
      turns: result.turns as unknown as Prisma.InputJsonValue,
      soundCues: result.soundCues as unknown as Prisma.InputJsonValue,
      markdown: result.markdown,
    },
  });

  // Save references from the script output (these still have [[ev_*]] markers —
  // the compile step will resolve them to proper [N] citations)
  if (result.references.length > 0) {
    await prisma.reference.createMany({
      data: result.references.map((ref, idx) => ({
        podcastId,
        number: idx + 1,
        title: ref.title,
        authors: ref.authors || '',
        year: ref.year ?? null,
        url: ref.url ?? null,
        type: ref.type || 'WEB',
        publisher: ref.publisher || null,
        doi: ref.doi || null,
      })),
    });
  }

  await job.updateProgress(80);

  // Auto-tag podcast
  const allTagSlugs = new Set<string>();
  const topicSlugs = matchTopicTags({
    topic: discovery.topic || '',
    focusAreas: [],
  });
  for (const slug of topicSlugs) {
    allTagSlugs.add(slug);
    const parent = TAG_PARENT_MAP[slug];
    if (parent) allTagSlugs.add(parent);
  }

  const existingTags = await prisma.tag.findMany({
    where: { slug: { in: [...allTagSlugs] } },
    select: { id: true, slug: true },
  });
  const tagsBySlug = new Map(existingTags.map(t => [t.slug, t.id]));

  const tagUpserts: Promise<unknown>[] = [];
  for (const slug of allTagSlugs) {
    const tagId = tagsBySlug.get(slug);
    if (tagId) {
      tagUpserts.push(
        prisma.podcastTag.upsert({
          where: { podcastId_tagId: { podcastId, tagId } },
          update: {},
          create: { podcastId, tagId },
        }),
      );
    }
  }
  await Promise.all(tagUpserts);

  // Detect language
  const sampleText = result.turns.slice(0, 5).map(t => t.text).join(' ');
  const languageDetectionModel = getCheapestModelForProvider(provider as AiProviderId);
  if (!languageDetectionModel) {
    throw new Error(`Language detection model is not configured for provider "${provider}".`);
  }
  const detectedLanguage = await detectLanguage(sampleText, {
    providerType: provider as AiProviderId,
    model: languageDetectionModel,
    apiKeyOverride: providerAiKey?.apiKey,
  });

  await job.updateProgress(85);

  await logUsage({
    service: provider,
    model,
    category: 'script',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    podcastId,
    userId,
  });

  await logPipelineStageComplete(podcastId, 'script-writing',
    `turns=${result.turns.length} refs=${result.references.length}`,
  );

  // Chain to compile/QC
  await prisma.podcast.update({
    where: { id: podcastId },
    data: {
      status: 'COMPILING',
      aiProvider: model.startsWith('claude-code:') ? 'claude-code' : provider,
      aiModel: model,
      language: detectedLanguage ?? undefined,
    },
  });
  await invalidatePodcastCache(podcastId);
  await publishPodcastStatus(podcastId, { status: 'COMPILING' });

  await addJob(compileScriptQueue, JobType.COMPILE_SCRIPT, {
    podcastId,
    userId,
  }, { jobId: `compile-${podcastId}-${Date.now()}` });

  logger.info('Script writing complete, queued compilation', {
    podcastId,
    turns: String(result.turns.length),
    references: String(result.references.length),
  });

  await job.updateProgress(100);
}
