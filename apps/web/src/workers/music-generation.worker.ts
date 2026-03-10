/**
 * Music generation worker — generates AI background music for podcasts.
 * Podcast must already be in READY status. Music is a separate track.
 */
import type { Job } from 'bullmq';
import type { GenerateMusicPayload } from '@/lib/queue';
import { addJob, notificationQueue, JobType } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { resolveMusicProvider } from '@/lib/providers/music';
import { buildMusicPrompt } from '@/lib/music-prompt-builder';
import { uploadFile } from '@/lib/r2';
import { logUsage } from '@/lib/usage-logger';
import { logger } from '@/lib/logger';

export async function processMusicGeneration(job: Job<GenerateMusicPayload>): Promise<void> {
  const { podcastId, musicGenerationId, userId } = job.data;

  logger.info('Starting music generation', { podcastId, musicGenerationId });
  await job.updateProgress(10);

  // Fetch podcast + music generation record
  const [podcast, musicGen] = await Promise.all([
    prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: {
        id: true,
        title: true,
        topic: true,
        duration: true,
        tags: { select: { tag: { select: { name: true } } } },
        user: { select: { plan: true } },
      },
    }),
    prisma.musicGeneration.findUniqueOrThrow({
      where: { id: musicGenerationId },
      select: { id: true, status: true, model: true, musicUrl: true },
    }),
  ]);

  // Idempotency: skip if already READY
  if (musicGen.status === 'READY' && musicGen.musicUrl) {
    logger.info('Music already generated, skipping', { musicGenerationId });
    return;
  }

  await job.updateProgress(20);

  // Update status to GENERATING
  await prisma.musicGeneration.update({
    where: { id: musicGenerationId },
    data: { status: 'GENERATING' },
  });

  // Resolve provider
  const { provider, source, providerId } = await resolveMusicProvider({
    userId,
    requestedModel: musicGen.model,
    plan: podcast.user.plan === 'PRO' ? 'PRO' : 'FREE',
  });

  await job.updateProgress(30);

  // Build prompt from podcast metadata
  const tags = podcast.tags.map((t: { tag: { name: string } }) => t.tag.name);
  const prompt = buildMusicPrompt({
    title: podcast.title,
    topic: podcast.topic,
    durationSeconds: podcast.duration ?? 300,
    tags,
  });

  // Store the prompt
  await prisma.musicGeneration.update({
    where: { id: musicGenerationId },
    data: { prompt, provider: providerId, model: provider.getModelId() },
  });

  await job.updateProgress(40);

  // Generate music
  const buffer = await provider.generateMusic({
    prompt,
    durationSeconds: podcast.duration ?? 300,
    instrumental: true,
    title: podcast.title,
  });

  // Persist external task ID for recovery (Suno async polling)
  if ('externalTaskId' in provider && provider.externalTaskId) {
    await prisma.musicGeneration.update({
      where: { id: musicGenerationId },
      data: { externalTaskId: provider.externalTaskId as string },
    });
  }

  await job.updateProgress(80);

  // Upload to R2 (unique key per generation to avoid overwrites)
  const r2Key = `podcasts/${podcastId}/music/${musicGenerationId}.mp3`;
  const musicUrl = await uploadFile(r2Key, buffer, 'audio/mpeg');

  await job.updateProgress(90);

  // Auto-select if this is the first generation for this podcast
  const existingCount = await prisma.musicGeneration.count({
    where: { podcastId, status: 'READY' },
  });
  const isFirst = existingCount === 0;

  // Update MusicGeneration; auto-select + denormalize only if first
  const txOps = [
    prisma.musicGeneration.update({
      where: { id: musicGenerationId },
      data: {
        status: 'READY',
        musicUrl,
        fileSize: buffer.length,
        selected: isFirst,
      },
    }),
  ];
  if (isFirst) {
    txOps.push(
      prisma.podcast.update({
        where: { id: podcastId },
        data: { musicUrl },
      }),
    );
  }
  await prisma.$transaction(txOps);

  // Log usage for cost tracking
  const service = source === 'byok' ? `${providerId}_byok` : providerId;
  logUsage({
    service,
    model: provider.getModelId(),
    category: 'music_generation',
    inputTokens: 0,
    outputTokens: 0,
    podcastId,
    userId,
    metadata: { musicGenerationId },
  });

  // Queue MUSIC_READY notification
  await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
    userId,
    type: 'MUSIC_READY',
    title: 'Background Music Ready',
    message: `Background music for "${podcast.title}" is ready.`,
    data: { podcastId },
  });

  await job.updateProgress(100);
  logger.info('Music generation complete', { podcastId, musicGenerationId, musicUrl });
}
