import { Job } from 'bullmq';
import { GenerateScriptPayload, addJob, JobType, scriptVerificationQueue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { generateScript } from '@/lib/script-generator';
import { logApiUsage } from '@/lib/claude';
import { logger } from '@/lib/logger';

export async function processScriptGeneration(job: Job<GenerateScriptPayload>): Promise<void> {
  const { podcastId, userId, discoveryId } = job.data;

  logger.info('Generating script', { podcastId });
  await job.updateProgress(10);

  // Get discovery metadata
  const discovery = await prisma.discovery.findUniqueOrThrow({
    where: { id: discoveryId },
  });

  const result = await generateScript({
    topic: discovery.topic || '',
    depth: discovery.depth || 'standard',
    audienceLevel: discovery.audienceLevel || 'intermediate',
    focusAreas: discovery.focusAreas,
    tone: discovery.tone || 'casual',
    durationTarget: discovery.durationTarget || 10,
    sourceContent: discovery.sourceContent || undefined,
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
