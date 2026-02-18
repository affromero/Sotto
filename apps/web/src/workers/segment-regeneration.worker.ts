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
  const { podcastId, interactionId, insertAfterOrder, newText, speaker } = job.data;

  logger.info('Regenerating segment', { podcastId, interactionId });
  await job.updateProgress(10);

  // Fetch podcast to determine voice configuration
  const podcast = await prisma.podcast.findUniqueOrThrow({
    where: { id: podcastId },
    select: {
      userId: true,
      hostVoiceId: true,
      expertVoiceId: true,
      ttsProvider: true,
      ttsModel: true,
    },
  });

  // Fetch discovery metadata for topic-aware voice selection
  const discovery = await prisma.discovery.findUnique({
    where: { podcastId },
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
  const { provider, source, providerId } = await resolveTtsProvider({
    userId: podcast.userId,
    podcastId,
    requestedProvider: (podcast.ttsProvider as TtsProviderId | null) ?? undefined,
    requestedModel: podcast.ttsModel,
  });

  const customVoiceId = speaker === 'HOST' ? podcast.hostVoiceId : podcast.expertVoiceId;
  const voiceId = customVoiceId || provider.getVoiceId(speaker, podcastId, voiceMetadata);

  logger.info('Segment regen: using TTS provider', {
    speaker,
    providerId,
    source,
    voiceId,
    podcastId,
  });

  const ttsText = cleanTextForTts(newText, { providerId });
  const audioBuffer = await provider.generateSpeech({ text: ttsText, voiceId });

  const charCount = ttsText.length;
  const ttsMeta = getProviderMeta(providerId);
  logUsage({
    service: providerId,
    category: 'segment_regeneration',
    inputTokens: charCount,
    totalCost: (charCount / 1000) * ttsMeta.platformCostPerKChar,
    podcastId,
    userId: podcast.userId,
    metadata: { voiceId, speaker },
  });

  await job.updateProgress(40);

  // Upload to R2
  const audioUrl = await uploadSegmentAudio(podcastId, `regen-${crypto.randomUUID()}`, audioBuffer);

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
      where: { podcastId, order: { gt: insertAfterOrder } },
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
        podcastId,
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
    where: { podcastId },
    orderBy: { order: 'asc' },
    select: { id: true },
  });

  await addJob(audioStitchingQueue, JobType.STITCH_AUDIO, {
    podcastId,
    segmentIds: allSegments.map((s) => s.id),
    skipSfx: true,
  });

  // Set status to STITCHING (the stitching worker will set READY when done)
  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'STITCHING' },
  });

  await job.updateProgress(100);
  logger.info('Segment regeneration complete, queued re-stitch', {
    podcastId,
    segmentId: newSegment.id,
    interactionId,
  });
}
