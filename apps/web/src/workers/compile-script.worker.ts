import { Job } from 'bullmq';
import { Prisma } from '@/generated/prisma/client';
import { CompileScriptPayload, addJob, JobType, notificationQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { compileScript } from '@/lib/script-compiler';
import { createSegmentsAndQueueAudio } from '@/lib/segment-creator';
import type { SourceRecord, EvidenceCard } from '@/lib/research-agent';
import { invalidateEpisodeCache, publishEpisodeStatus } from '@/lib/redis';
import { getGenerationFeatures } from '@/lib/generation-features';
import { getAutoModelConfig } from '@/lib/auto-model-config';
import { assignVoicesForEpisode } from '@/lib/voice-assigner';
import type { TtsProviderId } from '@/lib/providers/tts-registry';
import { logger } from '@/lib/logger';
import { logPipelineStageComplete } from '@/lib/pipeline-events';
import { verifyEpisodeReferences } from '@/lib/reference-verification/verify-episode';

export async function processCompileScript(job: Job<CompileScriptPayload>): Promise<void> {
  const { episodeId, userId, useAdminCredits } = job.data;

  logger.info('Script compilation starting', { episodeId });
  await job.updateProgress(10);

  // Load script, dossier, and episode metadata
  const [script, dossier, episode] = await Promise.all([
    prisma.script.findUniqueOrThrow({
      where: { episodeId },
      select: { turns: true, compiledAt: true },
    }),
    prisma.researchDossier.findUnique({
      where: { episodeId },
      select: { sources: true, evidence: true },
    }),
    prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      select: { source: true, topic: true, title: true },
    }),
  ]);

  const discovery = await prisma.discovery.findUniqueOrThrow({
    where: { episodeId },
    select: { depth: true, durationTarget: true },
  });

  const turns = script.turns as unknown as Array<{
    speaker: string;
    text: string;
    direction?: string;
  }>;
  const sources = (dossier?.sources as unknown as SourceRecord[]) || [];
  const evidence = (dossier?.evidence as unknown as EvidenceCard[]) || [];

  await job.updateProgress(30);

  let compiledTurns = turns;
  let referenceCount: number;
  let wordCount: number;

  if (script.compiledAt) {
    referenceCount = await prisma.reference.count({ where: { episodeId } });
    wordCount = turns.reduce(
      (total, turn) => total + turn.text.split(/\s+/).filter(Boolean).length,
      0
    );
    logger.info('Script already compiled; resuming post-compilation work', { episodeId });
  } else {
    const result = compileScript({
      turns,
      sources,
      evidence,
      depth: discovery.depth || 'standard',
      durationTarget: discovery.durationTarget || 10,
    });

    if (!result.success) {
      logger.error('Script compilation failed', {
        episodeId,
        errors: result.errors,
      });
      throw new Error(`Script compilation failed: ${result.errors.join('; ')}`);
    }

    await job.updateProgress(50);

    if (result.references.length > 0) {
      await prisma.reference.deleteMany({ where: { episodeId } });
      await prisma.reference.createMany({
        data: result.references.map((ref) => ({
          episodeId,
          number: ref.number,
          title: ref.title,
          authors: ref.authors.split(', ').filter(Boolean),
          year: ref.year,
          url: ref.url,
          doi: ref.doi,
          type: (ref.type || 'WEB') as 'WEB' | 'PAPER' | 'BOOK' | 'ARTICLE' | 'VIDEO' | 'REPORT',
          publisher: ref.publisher,
          verificationStatus: 'PENDING' as const,
        })),
      });
    }

    const referencesVerified = await verifyEpisodeReferences(
      episodeId,
      userId,
      episode.topic || episode.title,
      result.turns,
      useAdminCredits
    );
    if (!referencesVerified) {
      throw new Error('Reference verification failed: one or more cited claims are unsupported');
    }

    compiledTurns = result.turns;
    referenceCount = result.references.length;
    wordCount = result.stats.wordCount;
    await prisma.script.update({
      where: { episodeId },
      data: {
        turns: compiledTurns as unknown as Prisma.InputJsonValue,
        compiledAt: new Date(),
      },
    });
  }

  await job.updateProgress(70);

  await logPipelineStageComplete(
    episodeId,
    'compile-script',
    `refs=${referenceCount} words=${wordCount} errors=0`
  );

  // Determine whether to auto-approve or pause at SCRIPT_READY
  const genFeatures = getGenerationFeatures();

  const isWebOrImport = episode.source === 'WEB' || episode.source === 'IMPORT';
  const shouldAutoApprove = genFeatures.autoApproveScript || !isWebOrImport;

  if (!shouldAutoApprove) {
    // Pause for user review
    await prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'SCRIPT_READY' },
    });
    await invalidateEpisodeCache(episodeId);
    await publishEpisodeStatus(episodeId, { status: 'SCRIPT_READY' });

    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
      userId,
      type: 'SCRIPT_READY',
      title: 'Script ready for review',
      message: 'Your episode script is ready. Review and approve it to start audio generation.',
      data: { episodeId },
    });

    logger.info('Script compiled, paused at SCRIPT_READY for review', { episodeId });
  } else {
    // Auto-approve: select the configured TTS provider and create segments.
    const existingEpisode = await prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      select: { ttsProvider: true },
    });
    if (!existingEpisode.ttsProvider) {
      const selected = await getAutoModelConfig();
      await prisma.episode.update({
        where: { id: episodeId },
        data: { ttsProvider: selected.model.ttsProvider, ttsModel: selected.model.ttsModel },
      });
    }

    // Assign voices
    const lateEpisode = await prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      select: { ttsProvider: true },
    });
    const lateProvider = (lateEpisode.ttsProvider ?? 'elevenlabs') as TtsProviderId;
    const lateSpeakers = [...new Set(compiledTurns.map((t) => t.speaker))].map((name) => ({
      name,
    }));
    await assignVoicesForEpisode(episodeId, lateSpeakers, lateProvider);

    // Set GENERATING_AUDIO before creating segments — audio worker expects this status
    await prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'GENERATING_AUDIO' },
    });
    await invalidateEpisodeCache(episodeId);
    await publishEpisodeStatus(episodeId, { status: 'GENERATING_AUDIO' });

    await createSegmentsAndQueueAudio(episodeId, compiledTurns);

    logger.info('Script compiled and auto-approved, audio generation queued', { episodeId });
  }

  await job.updateProgress(100);
}
