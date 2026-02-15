import { Job } from 'bullmq';
import { GenerateScriptPayload, addJob, JobType, scriptVerificationQueue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { generateScript, type SourceMetadata } from '@/lib/script-generator';
import { logApiUsage } from '@/lib/claude';
import { getAiKey } from '@/lib/byok';
import { logger } from '@/lib/logger';

export async function processScriptGeneration(job: Job<GenerateScriptPayload>): Promise<void> {
  const { podcastId, userId, discoveryId } = job.data;

  logger.info('Generating script', { podcastId });
  await job.updateProgress(10);

  // Idempotency: skip if script already exists
  const existingScript = await prisma.script.findUnique({
    where: { podcastId },
    select: { id: true },
  });

  if (existingScript) {
    logger.info('Script already exists, skipping to verification', { podcastId });

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'VERIFYING_SCRIPT' },
    });

    await addJob(scriptVerificationQueue, JobType.VERIFY_SCRIPT, {
      podcastId,
      userId,
      discoveryId,
    });

    await job.updateProgress(100);
    return;
  }

  const aiKey = await getAiKey(userId);

  // Get discovery metadata
  const discovery = await prisma.discovery.findUniqueOrThrow({
    where: { id: discoveryId },
  });

  const sourceMetadata = discovery.sourceMetadata as SourceMetadata | null;

  const result = await generateScript({
    topic: discovery.topic || '',
    depth: discovery.depth || 'standard',
    audienceLevel: discovery.audienceLevel || 'intermediate',
    audience: discovery.audience || 'general',
    focusAreas: discovery.focusAreas,
    tone: discovery.tone || 'casual',
    durationTarget: discovery.durationTarget || 10,
    sourceContent: discovery.sourceContent || undefined,
    sourceMetadata: sourceMetadata || undefined,
    apiKeyOverride: aiKey?.apiKey,
  });

  await job.updateProgress(50);

  // Save script (including sound cues for the stitching pipeline)
  await prisma.script.create({
    data: {
      podcastId,
      turns: result.turns,
      soundCues: result.soundCues.length > 0 ? result.soundCues : undefined,
      markdown: result.markdown,
    },
  });

  // Persist references
  if (result.references.length > 0) {
    await prisma.reference.createMany({
      data: result.references.map((ref) => ({
        podcastId,
        number: ref.number,
        title: ref.title,
        authors: ref.authors,
        year: ref.year,
        url: ref.url,
        type: ref.type,
        publisher: ref.publisher,
        doi: ref.doi,
      })),
    });
    logger.info('References saved', { podcastId, count: String(result.references.length) });
  }

  // Auto-assign audience tag
  const audienceSlugMap: Record<string, string> = {
    kids: 'kids',
    teens: 'teens',
    family: 'family-friendly',
    general: 'general-audience',
    mature: 'mature-topics',
  };
  const audienceSlug = audienceSlugMap[discovery.audience || 'general'];
  if (audienceSlug) {
    const audienceTag = await prisma.tag.findUnique({ where: { slug: audienceSlug } });
    if (audienceTag) {
      await prisma.podcastTag.upsert({
        where: { podcastId_tagId: { podcastId, tagId: audienceTag.id } },
        update: {},
        create: { podcastId, tagId: audienceTag.id },
      });
    }
  }

  // Route to script verification (handles both with and without references)
  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'VERIFYING_SCRIPT' },
  });

  await addJob(scriptVerificationQueue, JobType.VERIFY_SCRIPT, {
    podcastId,
    userId,
    discoveryId,
  });

  logger.info('Script queued for verification', {
    podcastId,
    references: String(result.references.length),
  });

  // Log API usage
  await logApiUsage({
    podcastId,
    userId,
    category: 'script_generation',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });

  await job.updateProgress(100);
  logger.info('Script generation complete', {
    podcastId,
    references: String(result.references.length),
  });
}
