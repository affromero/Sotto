import { Job } from 'bullmq';
import {
  GenerateVoiceTrackAudioPayload,
  addJob,
  JobType,
  voiceTrackStitchingQueue,
} from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { resolveTtsProvider } from '@/lib/providers';
import { type TtsProviderId } from '@/lib/providers/tts-registry';
import { uploadVoiceTrackSegmentAudio } from '@/lib/r2';
import type { VoiceMatchMetadata } from '@/lib/voice-pool';
import { generateTtsAudio } from '@/lib/tts-generation';
import { logger } from '@/lib/logger';

export async function processVoiceTrackAudio(
  job: Job<GenerateVoiceTrackAudioPayload>
): Promise<void> {
  const {
    podcastId,
    voiceTrackId,
    voiceTrackSegmentId,
    segmentId,
    speaker,
    text,
    previousText,
    nextText,
    direction,
  } = job.data;

  logger.info('Generating voice track audio for segment', {
    podcastId,
    voiceTrackId,
    segmentId,
    speaker,
  });
  await job.updateProgress(10);

  // Fail-fast: skip if voice track already failed (another segment errored first)
  const trackStatus = await prisma.voiceTrack.findUnique({
    where: { id: voiceTrackId },
    select: { status: true },
  });

  if (trackStatus?.status === 'FAILED') {
    logger.info('Voice track already failed, skipping segment', { voiceTrackId, segmentId });
    await job.updateProgress(100);
    return;
  }

  // Idempotency: skip if segment already has audio
  const existingSegment = await prisma.voiceTrackSegment.findUnique({
    where: { id: voiceTrackSegmentId },
    select: { audioUrl: true },
  });

  if (existingSegment?.audioUrl) {
    logger.info('Voice track segment already has audio, skipping TTS', { voiceTrackId, segmentId });

    // Still check if all segments are done
    const pendingSegments = await prisma.voiceTrackSegment.count({
      where: { voiceTrackId, audioUrl: null },
    });

    if (pendingSegments === 0) {
      const segments = await prisma.voiceTrackSegment.findMany({
        where: { voiceTrackId },
        orderBy: { order: 'asc' },
        select: { id: true },
      });

      await addJob(voiceTrackStitchingQueue, JobType.STITCH_VOICE_TRACK, {
        podcastId,
        voiceTrackId,
        voiceTrackSegmentIds: segments.map((s) => s.id),
      });

      await prisma.voiceTrack.update({
        where: { id: voiceTrackId },
        data: { status: 'STITCHING' },
      });
    }

    await job.updateProgress(100);
    return;
  }

  // Fetch voice track to determine voice configuration
  const voiceTrack = await prisma.voiceTrack.findUniqueOrThrow({
    where: { id: voiceTrackId },
    select: {
      ttsProvider: true,
      ttsModel: true,
      voices: { select: { speaker: true, voiceId: true, provider: true, ttsModel: true } },
      podcast: {
        select: { userId: true, language: true },
      },
    },
  });

  const userId = voiceTrack.podcast.userId;

  // Fetch discovery metadata for topic-aware voice selection (feature parity with audio-generation)
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

  // Resolve provider per-speaker: use the speaker's VoiceTrackVoice.provider if set, else fall back to track-level
  const trackVoice = voiceTrack.voices.find((v) => v.speaker === speaker);
  const requestedProvider = (trackVoice?.provider ??
    voiceTrack.ttsProvider) as TtsProviderId | null;
  if (!requestedProvider) {
    throw new Error(
      `Voice track ${voiceTrackId} is missing a TTS provider for speaker ${speaker}. Select a provider before generating audio.`
    );
  }

  // Use per-voice model (not track-level) — voice tracks have mixed providers,
  // so each speaker's model must match their provider.
  const requestedModel = trackVoice?.ttsModel ?? undefined;
  const podcastLanguage = voiceTrack.podcast.language;
  const { provider, source, providerId } = await resolveTtsProvider({
    userId,
    podcastId,
    requestedProvider,
    requestedModel,
    language: podcastLanguage,
  });

  const ttsModelId = provider.getModelId();

  // Write back the track model only when generation used the track-level provider.
  if (voiceTrack.ttsProvider === providerId && !voiceTrack.ttsModel) {
    await prisma.voiceTrack
      .update({
        where: { id: voiceTrackId },
        data: { ttsModel: ttsModelId },
      })
      .catch((err) => {
        logger.warn('Failed to write back TTS provider to voice track', {
          voiceTrackId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  // Use voice track voice assignment if provider matches, otherwise let provider pick from pool
  const voiceId =
    trackVoice?.voiceId && trackVoice.provider === providerId
      ? trackVoice.voiceId
      : provider.getVoiceId(speaker, podcastId, voiceMetadata, podcastLanguage ?? undefined);

  // Persist resolved voice for retry consistency
  if (!trackVoice || trackVoice.provider !== providerId || trackVoice.voiceId !== voiceId) {
    try {
      await prisma.voiceTrackVoice.upsert({
        where: { voiceTrackId_speaker: { voiceTrackId, speaker } },
        update: { voiceId, provider: providerId, ttsModel: ttsModelId },
        create: { voiceTrackId, speaker, voiceId, provider: providerId, ttsModel: ttsModelId },
      });
    } catch (err) {
      logger.warn('Failed to persist voice track voice assignment', {
        podcastId,
        voiceTrackId,
        speaker,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---- Shared TTS generation core ----
  const result = await generateTtsAudio({
    text,
    voiceId,
    speaker,
    previousText,
    nextText,
    direction,
    language: podcastLanguage,
    provider,
    providerId,
    source,
    requestedModel,
    userId,
    podcastId,
    usageCategory: 'voice_track_audio',
    extraMetadata: { voiceTrackId },
    isAborted: async () => {
      const check = await prisma.voiceTrack.findUnique({
        where: { id: voiceTrackId },
        select: { status: true },
      });
      return check?.status === 'FAILED';
    },
  });

  if (!result) {
    logger.info('Voice track failed while waiting for semaphore, skipping', {
      voiceTrackId,
      segmentId,
    });
    await job.updateProgress(100);
    return;
  }

  await job.updateProgress(60);

  // Upload to R2
  const audioUrl = await uploadVoiceTrackSegmentAudio(
    podcastId,
    voiceTrackId,
    segmentId,
    result.audioBuffer
  );

  // Update voice track segment with audio URL and duration
  await prisma.voiceTrackSegment.update({
    where: { id: voiceTrackSegmentId },
    data: { audioUrl, duration: result.segmentDuration },
  });

  await job.updateProgress(90);

  // Check if all segments for this voice track are done
  const pendingSegments = await prisma.voiceTrackSegment.count({
    where: { voiceTrackId, audioUrl: null },
  });

  if (pendingSegments === 0) {
    const segments = await prisma.voiceTrackSegment.findMany({
      where: { voiceTrackId },
      orderBy: { order: 'asc' },
      select: { id: true },
    });

    await addJob(voiceTrackStitchingQueue, JobType.STITCH_VOICE_TRACK, {
      podcastId,
      voiceTrackId,
      voiceTrackSegmentIds: segments.map((s) => s.id),
    });

    await prisma.voiceTrack.update({
      where: { id: voiceTrackId },
      data: { status: 'STITCHING' },
    });
  }

  await job.updateProgress(100);
  logger.info('Voice track audio generation complete for segment', {
    voiceTrackId,
    segmentId,
    service: result.service,
  });
}
