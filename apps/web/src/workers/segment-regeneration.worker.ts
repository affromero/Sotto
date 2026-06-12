import { Job } from 'bullmq';
import { RegenerateSegmentPayload, addJob, JobType, audioStitchingQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { resolveTtsProvider } from '@/lib/providers';
import type { TtsProviderId } from '@/lib/providers/tts-registry';
import { getProviderMeta } from '@/lib/providers/tts-registry';
import { logUsage } from '@/lib/usage-logger';
import { uploadSegmentAudio } from '@/lib/r2';
import { getAudioDuration } from '@/lib/audio-stitcher';
import { cleanTextForTts } from '@/lib/tts-text-cleaner';
import { invalidateEpisodeCache, publishEpisodeStatus } from '@/lib/redis';
import { estimateDurationFromText } from '@/lib/duration';
import type { VoiceMatchMetadata } from '@/lib/voice-pool';
import { logger } from '@/lib/logger';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { writeFile, rm } from 'fs/promises';

export async function processSegmentRegeneration(
  job: Job<RegenerateSegmentPayload>
): Promise<void> {
  const { episodeId, interactionId, insertAfterOrder, newText, speaker } = job.data;

  logger.info('Regenerating segment', { episodeId, interactionId });
  await job.updateProgress(10);

  // Fetch episode to determine voice configuration
  const episode = await prisma.episode.findUniqueOrThrow({
    where: { id: episodeId },
    select: {
      userId: true,
      language: true,
      voices: { select: { speaker: true, voiceId: true, provider: true } },
      ttsProvider: true,
      ttsModel: true,
    },
  });

  // Fetch discovery metadata for topic-aware voice selection
  const discovery = await prisma.discovery.findUnique({
    where: { episodeId },
    select: { tone: true, audienceLevel: true, audience: true },
  });

  const voiceMetadata: VoiceMatchMetadata | undefined = discovery
    ? {
        tone: discovery.tone as VoiceMatchMetadata['tone'],
        audienceLevel: discovery.audienceLevel as VoiceMatchMetadata['audienceLevel'],
        audience: discovery.audience as VoiceMatchMetadata['audience'],
      }
    : undefined;

  // Resolve provider using multi-provider system (matches audio-generation worker)
  if (!episode.ttsProvider) {
    throw new Error(
      `Episode ${episodeId} is missing a TTS provider. Select a provider before regenerating audio.`
    );
  }

  const { provider, source, providerId } = await resolveTtsProvider({
    userId: episode.userId,
    episodeId,
    requestedProvider: episode.ttsProvider as TtsProviderId,
    requestedModel: episode.ttsModel,
    language: episode.language,
  });

  const episodeVoice = episode.voices.find((v) => v.speaker === speaker);
  const voiceId =
    episodeVoice?.voiceId && episodeVoice.provider === providerId
      ? episodeVoice.voiceId
      : provider.getVoiceId(speaker, episodeId, voiceMetadata, episode.language ?? undefined);

  // Persist resolved voice for retry consistency and analytics
  if (!episodeVoice || episodeVoice.provider !== providerId || episodeVoice.voiceId !== voiceId) {
    try {
      await prisma.episodeVoice.upsert({
        where: { episodeId_speaker: { episodeId, speaker } },
        update: { voiceId, provider: providerId },
        create: { episodeId, speaker, voiceId, provider: providerId },
      });
    } catch (err) {
      logger.warn('Failed to persist voice assignment', {
        episodeId,
        speaker,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('Segment regen: using TTS provider', {
    speaker,
    providerId,
    source,
    voiceId,
    episodeId,
  });

  const ttsText = cleanTextForTts(newText);
  const audioBuffer = await provider.generateSpeech({
    text: ttsText,
    voiceId,
    language: episode.language ?? undefined,
  });

  const charCount = ttsText.length;
  const ttsMeta = getProviderMeta(providerId);
  logUsage({
    service: providerId,
    category: 'segment_regeneration',
    inputTokens: charCount,
    totalCost: (charCount / 1000) * ttsMeta.platformCostPerKChar,
    episodeId,
    userId: episode.userId,
    metadata: { voiceId, speaker },
  });

  await job.updateProgress(40);

  // Upload to R2
  const audioUrl = await uploadSegmentAudio(episodeId, `regen-${crypto.randomUUID()}`, audioBuffer);

  // Measure actual audio duration via FFprobe
  let segmentDuration: number;
  const tmpPath = path.join(os.tmpdir(), `sotto-regen-probe-${crypto.randomUUID()}.mp3`);
  try {
    await writeFile(tmpPath, audioBuffer);
    segmentDuration = await getAudioDuration(tmpPath);
  } catch (err) {
    logger.warn('FFprobe failed for regenerated segment, estimating from text', {
      error: err instanceof Error ? err.message : String(err),
    });
    segmentDuration = estimateDurationFromText(newText);
  } finally {
    await rm(tmpPath, { force: true }).catch(() => {});
  }

  await job.updateProgress(60);

  // Insert segment and reorder in a transaction to prevent race conditions
  const newSegment = await prisma.$transaction(async (tx) => {
    // Shift all segments with order > insertAfterOrder up by 1
    // Update in descending order to avoid unique constraint violations
    const toShift = await tx.segment.findMany({
      where: { episodeId, order: { gt: insertAfterOrder } },
      orderBy: { order: 'desc' },
      select: { id: true, order: true },
    });

    for (const seg of toShift) {
      await tx.segment.update({
        where: { id: seg.id },
        data: { order: seg.order + 1 },
      });
    }

    // Create the new segment at the correct position
    return tx.segment.create({
      data: {
        episodeId,
        speaker,
        text: newText,
        audioUrl,
        duration: segmentDuration,
        order: insertAfterOrder + 1,
      },
    });
  });

  await job.updateProgress(75);

  // Mark interaction as incorporated
  await prisma.interaction.update({
    where: { id: interactionId },
    data: { status: 'INCORPORATED', incorporated: true },
  });

  // Queue re-stitch with skipSfx (SFX positions are invalid after inserting a segment)
  const allSegments = await prisma.segment.findMany({
    where: { episodeId },
    orderBy: { order: 'asc' },
    select: { id: true },
  });

  await addJob(audioStitchingQueue, JobType.STITCH_AUDIO, {
    episodeId,
    segmentIds: allSegments.map((s) => s.id),
    skipSfx: true,
  });

  // Set status to STITCHING (the stitching worker will set READY when done)
  await prisma.episode.update({
    where: { id: episodeId },
    data: { status: 'STITCHING' },
  });
  await invalidateEpisodeCache(episodeId);
  await publishEpisodeStatus(episodeId, { status: 'STITCHING' });

  await job.updateProgress(100);
  logger.info('Segment regeneration complete, queued re-stitch', {
    episodeId,
    segmentId: newSegment.id,
    interactionId,
  });
}
