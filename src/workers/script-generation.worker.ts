import { Job } from 'bullmq';
import {
  GenerateScriptPayload,
  addJob,
  JobType,
  audioGenerationQueue,
  referenceValidationQueue,
} from '@/lib/queue';
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

  // Route based on whether references exist
  if (result.references.length > 0) {
    // References exist: route through validation pipeline
    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'VALIDATING_REFERENCES' },
    });

    await addJob(referenceValidationQueue, JobType.VALIDATE_REFERENCES, {
      podcastId,
      userId,
    });

    logger.info('References queued for validation', { podcastId, count: String(result.references.length) });
  } else {
    // No references: create segments and go directly to audio generation
    const turns = result.turns as Array<{ speaker: 'HOST' | 'EXPERT'; text: string }>;
    for (let i = 0; i < turns.length; i++) {
      const segment = await prisma.segment.create({
        data: {
          podcastId,
          speaker: turns[i].speaker,
          text: turns[i].text,
          order: i,
        },
      });

      await addJob(audioGenerationQueue, JobType.GENERATE_AUDIO, {
        podcastId,
        segmentId: segment.id,
        speaker: turns[i].speaker,
        text: turns[i].text,
      });
    }

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'GENERATING_AUDIO' },
    });
  }

  // Log API usage
  await logApiUsage({
    podcastId,
    userId,
    category: 'script_generation',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });

  await job.updateProgress(100);
  logger.info('Script generation complete', { podcastId, references: String(result.references.length) });
}
