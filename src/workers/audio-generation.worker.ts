import { Job } from 'bullmq';
import { GenerateAudioPayload, addJob, JobType, audioStitchingQueue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { resolveTtsProvider } from '@/lib/providers';
import { getProviderMeta, type TtsProviderId } from '@/lib/providers/tts-registry';
import { uploadSegmentAudio } from '@/lib/r2';
import { getAudioDuration } from '@/lib/audio-stitcher';
import { logger } from '@/lib/logger';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { writeFile, rm } from 'fs/promises';

/**
 * Estimate audio duration from text length as a fallback.
 * Average speech rate: ~150 words/min, average word length ~5 chars.
 * So ~750 chars/min → ~12.5 chars/sec.
 */
function estimateDurationFromText(text: string): number {
  const charsPerSecond = 12.5;
  return text.length / charsPerSecond;
}

export async function processAudioGeneration(job: Job<GenerateAudioPayload>): Promise<void> {
  const { podcastId, segmentId, speaker, text } = job.data;

  logger.info('Generating audio for segment', { podcastId, segmentId, speaker });
  await job.updateProgress(10);

  // Fetch podcast to determine voice configuration
  const podcast = await prisma.podcast.findUniqueOrThrow({
    where: { id: podcastId },
    select: {
      userId: true,
      usePremiumVoice: true,
      hostVoiceId: true,
      expertVoiceId: true,
      ttsProvider: true,
    },
  });

  const startTime = Date.now();

  // Resolve provider using the multi-provider system
  const { provider, source, providerId } = await resolveTtsProvider({
    userId: podcast.userId,
    podcastId,
    requestedProvider: (podcast.ttsProvider as TtsProviderId | null) ?? undefined,
    usePremiumVoice: podcast.usePremiumVoice,
  });

  // Use custom voice ID if set, otherwise let the provider pick from its pool
  const customVoiceId = speaker === 'HOST' ? podcast.hostVoiceId : podcast.expertVoiceId;
  const voiceId = customVoiceId || provider.getVoiceId(speaker, podcastId);

  logger.info('Using TTS provider', {
    speaker,
    providerId,
    source,
    voiceId,
    podcastId,
  });

  const audioBuffer = await provider.generateSpeech({ text, voiceId });
  const service = source === 'byok' ? `${providerId}_byok` : providerId;

  const durationMs = Date.now() - startTime;

  await job.updateProgress(60);

  // Upload to R2
  const audioUrl = await uploadSegmentAudio(podcastId, segmentId, audioBuffer);

  // Measure actual audio duration via FFprobe
  let segmentDuration: number;
  const tmpPath = path.join(os.tmpdir(), `sotto-probe-${crypto.randomUUID()}.mp3`);
  try {
    await writeFile(tmpPath, audioBuffer);
    segmentDuration = await getAudioDuration(tmpPath);
  } catch (err) {
    logger.warn('FFprobe duration extraction failed, estimating from text length', {
      segmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    segmentDuration = estimateDurationFromText(text);
  } finally {
    await rm(tmpPath, { force: true }).catch(() => {});
  }

  // Update segment with audio URL and duration
  await prisma.segment.update({
    where: { id: segmentId },
    data: { audioUrl, duration: segmentDuration },
  });

  // Log TTS cost — BYOK = $0 platform cost
  const charCount = text.length;
  let totalCost = 0;
  if (source === 'platform') {
    const meta = getProviderMeta(providerId);
    totalCost = (charCount / 1000) * meta.platformCostPerKChar;
  }

  await prisma.apiUsageLog.create({
    data: {
      podcastId,
      userId: podcast.userId,
      service,
      category: 'audio_generation',
      inputTokens: charCount,
      totalCost,
      durationMs,
      metadata: { voiceId, speaker, providerId, source },
    },
  });

  await job.updateProgress(90);

  // Check if all segments for this podcast are done
  const pendingSegments = await prisma.segment.count({
    where: { podcastId, audioUrl: null },
  });

  if (pendingSegments === 0) {
    // All segments generated — queue stitching
    const segments = await prisma.segment.findMany({
      where: { podcastId },
      orderBy: { order: 'asc' },
      select: { id: true },
    });

    await addJob(audioStitchingQueue, JobType.STITCH_AUDIO, {
      podcastId,
      segmentIds: segments.map((s) => s.id),
    });

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'STITCHING' },
    });
  }

  await job.updateProgress(100);
  logger.info('Audio generation complete for segment', { podcastId, segmentId, service });
}
