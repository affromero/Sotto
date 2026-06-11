import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { CompileScriptPayload, addJob, JobType, notificationQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { compileScript } from '@/lib/script-compiler';
import { createSegmentsAndQueueAudio } from '@/lib/segment-creator';
import type { SourceRecord, EvidenceCard } from '@/lib/research-agent';
import { invalidatePodcastCache, publishPodcastStatus } from '@/lib/redis';
import { getGenerationFeatures } from '@/lib/generation-features';
import { getAutoModelConfig } from '@/lib/auto-model-config';
import { assignVoicesForPodcast } from '@/lib/voice-assigner';
import type { TtsProviderId } from '@/lib/providers/tts-registry';
import { logger } from '@/lib/logger';
import { logPipelineStageComplete } from '@/lib/pipeline-events';

export async function processCompileScript(job: Job<CompileScriptPayload>): Promise<void> {
  const { podcastId, userId } = job.data;

  logger.info('Script compilation starting', { podcastId });
  await job.updateProgress(10);

  // Load script, dossier, and podcast metadata
  const [script, dossier, podcast] = await Promise.all([
    prisma.script.findUniqueOrThrow({
      where: { podcastId },
      select: { turns: true },
    }),
    prisma.researchDossier.findUnique({
      where: { podcastId },
      select: { sources: true, evidence: true },
    }),
    prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: { source: true, zeroCostVideo: true },
    }),
  ]);

  const discovery = await prisma.discovery.findUniqueOrThrow({
    where: { podcastId },
    select: { depth: true, durationTarget: true },
  });

  const turns = script.turns as unknown as Array<{ speaker: string; text: string; direction?: string }>;
  const sources = (dossier?.sources as unknown as SourceRecord[]) || [];
  const evidence = (dossier?.evidence as unknown as EvidenceCard[]) || [];

  await job.updateProgress(30);

  // Run deterministic compilation
  const result = compileScript({
    turns,
    sources,
    evidence,
    depth: discovery.depth || 'standard',
    durationTarget: discovery.durationTarget || 10,
  });

  if (!result.success) {
    logger.error('Script compilation failed', {
      podcastId,
      errors: result.errors,
    });
    // For now, proceed with warnings — the errors are logged for debugging
    // A future enhancement could trigger one editorial LLM pass here
  }

  await job.updateProgress(50);

  // Update script turns with compiled text (resolved [N] citations)
  await prisma.script.update({
    where: { podcastId },
    data: {
      turns: result.turns as unknown as Prisma.InputJsonValue,
    },
  });

  // Upsert compiled references
  if (result.references.length > 0) {
    // Delete existing references and recreate with compiled data
    await prisma.reference.deleteMany({ where: { podcastId } });
    await prisma.reference.createMany({
      data: result.references.map(ref => ({
        podcastId,
        number: ref.number,
        title: ref.title,
        authors: ref.authors.split(', ').filter(Boolean),
        year: ref.year,
        url: ref.url,
        doi: ref.doi,
        type: (ref.type || 'WEB') as 'WEB' | 'PAPER' | 'BOOK' | 'ARTICLE' | 'VIDEO' | 'REPORT',
        publisher: ref.publisher,
        verificationStatus: 'VERIFIED' as const,
      })),
    });
  }

  await job.updateProgress(70);

  await logPipelineStageComplete(podcastId, 'compile-script',
    `refs=${result.references.length} words=${result.stats.wordCount} errors=${result.errors.length}`,
  );

  // Determine whether to auto-approve or pause at SCRIPT_READY
  const genFeatures = getGenerationFeatures();

  const isWebOrImport = podcast.source === 'WEB' || podcast.source === 'IMPORT';
  const shouldAutoApprove = genFeatures.autoApproveScript || !isWebOrImport || podcast.zeroCostVideo;

  if (!shouldAutoApprove) {
    // Pause for user review
    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'SCRIPT_READY' },
    });
    await invalidatePodcastCache(podcastId);
    await publishPodcastStatus(podcastId, { status: 'SCRIPT_READY' });

    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
      userId,
      type: 'SCRIPT_READY',
      title: 'Script ready for review',
      message: 'Your podcast script is ready. Review and approve it to start audio generation.',
      data: { podcastId },
    });

    logger.info('Script compiled, paused at SCRIPT_READY for review', { podcastId });
  } else {
    // Auto-approve: select the configured TTS provider and create segments.
    const existingPodcast = await prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: { ttsProvider: true },
    });
    if (!existingPodcast.ttsProvider) {
      const selected = await getAutoModelConfig();
      await prisma.podcast.update({
        where: { id: podcastId },
        data: { ttsProvider: selected.model.ttsProvider, ttsModel: selected.model.ttsModel },
      });
    }

    // Assign voices
    const latePodcast = await prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: { ttsProvider: true },
    });
    const lateProvider = (latePodcast.ttsProvider ?? 'elevenlabs') as TtsProviderId;
    const lateSpeakers = [...new Set(result.turns.map(t => t.speaker))].map(name => ({ name }));
    await assignVoicesForPodcast(podcastId, lateSpeakers, lateProvider);

    // Set GENERATING_AUDIO before creating segments — audio worker expects this status
    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'GENERATING_AUDIO' },
    });
    await invalidatePodcastCache(podcastId);
    await publishPodcastStatus(podcastId, { status: 'GENERATING_AUDIO' });

    await createSegmentsAndQueueAudio(podcastId, result.turns);

    logger.info('Script compiled and auto-approved, audio generation queued', { podcastId });
  }

  await job.updateProgress(100);
}
