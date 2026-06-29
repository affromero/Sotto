import { Job } from 'bullmq';
import { GenerateAudioPayload, addJob, JobType, audioStitchingQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { resolveTtsProvider, createTtsProviderAsync } from '@/lib/providers';
import { type TtsProviderId } from '@/lib/providers/tts-registry';
import type { TtsProvider } from '@/lib/providers/tts';
import { assertStorageWritable, uploadSegmentAudio } from '@/lib/r2';
import type { VoiceMatchMetadata } from '@/lib/voice-pool';
import { generateTtsAudio, getPlatformTtsKey } from '@/lib/tts-generation';
import { invalidateEpisodeCache, publishEpisodeStatus } from '@/lib/redis';
import { logger } from '@/lib/logger';

export async function processAudioGeneration(job: Job<GenerateAudioPayload>): Promise<void> {
  const { episodeId, segmentId, speaker, text, previousText, nextText, direction } = job.data;

  logger.info('Generating audio for segment', { episodeId, segmentId, speaker });
  await job.updateProgress(10);

  // Fail-fast: skip if episode already failed (another segment errored first)
  const episodeStatus = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { status: true },
  });

  if (episodeStatus?.status === 'FAILED') {
    logger.info('Episode already failed, skipping segment', { episodeId, segmentId });
    await job.updateProgress(100);
    return;
  }

  // Idempotency: skip if segment already has audio; also fetch per-segment TTS overrides
  const existingSegment = await prisma.segment.findUnique({
    where: { id: segmentId },
    select: { audioUrl: true, ttsProvider: true, ttsModel: true, ttsVoiceId: true },
  });

  if (existingSegment?.audioUrl) {
    logger.info('Segment already has audio, skipping TTS', { episodeId, segmentId });

    // Still check if all segments are done — may need to trigger stitching
    const pendingSegments = await prisma.segment.count({
      where: { episodeId, audioUrl: null },
    });

    if (pendingSegments === 0) {
      const segments = await prisma.segment.findMany({
        where: { episodeId },
        orderBy: { order: 'asc' },
        select: { id: true },
      });

      // Queue stitch with stable jobId (idempotent — BullMQ deduplicates)
      await addJob(
        audioStitchingQueue,
        JobType.STITCH_AUDIO,
        {
          episodeId,
          segmentIds: segments.map((s) => s.id),
        },
        { jobId: `stitch-${episodeId}-${Date.now()}` }
      );

      // CAS status transition — only one worker wins
      const cas = await prisma.episode.updateMany({
        where: { id: episodeId, status: 'GENERATING_AUDIO' },
        data: { status: 'STITCHING' },
      });
      if (cas.count > 0) {
        await invalidateEpisodeCache(episodeId);
        await publishEpisodeStatus(episodeId, { status: 'STITCHING' });
      } else {
        logger.info('Another worker already transitioned to STITCHING', { episodeId });
      }
    }

    await job.updateProgress(100);
    return;
  }

  await assertStorageWritable();

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

  let voiceMetadata: VoiceMatchMetadata | undefined = discovery
    ? {
        tone: discovery.tone as VoiceMatchMetadata['tone'],
        audienceLevel: discovery.audienceLevel as VoiceMatchMetadata['audienceLevel'],
        audience: discovery.audience as VoiceMatchMetadata['audience'],
      }
    : undefined;

  // When discovery doesn't have a tone, infer from script delivery directions
  if (!voiceMetadata?.tone) {
    const script = await prisma.script.findUnique({
      where: { episodeId },
      select: { turns: true },
    });
    if (script?.turns) {
      const turns = script.turns as Array<{ direction?: string }>;
      const directions = turns
        .map((t) => t.direction?.toLowerCase() ?? '')
        .filter(Boolean)
        .join(' ');
      if (directions) {
        const casualPatterns = /excited|enthusiastic|laughing|playful|humorous|energetic|fun/;
        const professionalPatterns =
          /serious|academic|formal|whispering|soft|calm|measured|thoughtful/;
        const casualCount = (directions.match(casualPatterns) || []).length;
        const professionalCount = (directions.match(professionalPatterns) || []).length;
        if (casualCount > 0 || professionalCount > 0) {
          const inferredTone = casualCount >= professionalCount ? 'casual' : 'professional';
          voiceMetadata = { ...voiceMetadata, tone: inferredTone };
        }
      }
    }
  }

  let provider: TtsProvider;
  let providerId: TtsProviderId;
  let source: string;
  let voiceId: string;

  if (existingSegment?.ttsProvider) {
    // ---- Per-segment TTS override (admin showcase builder) ----
    const segProviderId = existingSegment.ttsProvider as TtsProviderId;
    const platformKey = getPlatformTtsKey(segProviderId);
    provider = await createTtsProviderAsync(
      segProviderId,
      platformKey,
      undefined,
      existingSegment.ttsModel ?? undefined
    );
    providerId = segProviderId;
    source = 'platform';

    voiceId =
      existingSegment.ttsVoiceId ??
      provider.getVoiceId(speaker, episodeId, voiceMetadata, episode.language ?? undefined);

    // Persist resolved voice for consistency
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
  } else {
    // ---- Standard flow: resolve provider at episode level ----
    if (!episode.ttsProvider) {
      throw new Error(
        `Episode ${episodeId} is missing a TTS provider. Select a provider before generating audio.`
      );
    }

    const resolved = await resolveTtsProvider({
      userId: episode.userId,
      episodeId,
      requestedProvider: episode.ttsProvider as TtsProviderId,
      requestedModel: episode.ttsModel,
      language: episode.language,
    });
    provider = resolved.provider;
    providerId = resolved.providerId;
    source = resolved.source;

    const ttsModelId = provider.getModelId();

    // Write back resolved provider and model if not already set
    if (!episode.ttsProvider || !episode.ttsModel) {
      await prisma.episode
        .update({
          where: { id: episodeId },
          data: { ttsProvider: providerId, ttsModel: ttsModelId },
        })
        .catch((err) => {
          logger.warn('Failed to write back TTS provider to episode', {
            episodeId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }

    // Use custom voice ID if set and provider matches, otherwise let the provider pick from its pool
    const episodeVoice = episode.voices.find((v) => v.speaker === speaker);
    voiceId =
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
  }

  // ---- Shared TTS generation core ----
  const result = await generateTtsAudio({
    text,
    voiceId,
    speaker,
    previousText,
    nextText,
    direction,
    language: episode.language,
    provider,
    providerId,
    source,
    userId: episode.userId,
    episodeId,
    requestedModel: episode.ttsModel,
    usageCategory: 'audio_generation',
    isAborted: async () => {
      const check = await prisma.episode.findUnique({
        where: { id: episodeId },
        select: { status: true },
      });
      return check?.status === 'FAILED';
    },
  });

  if (!result) {
    logger.info('Episode failed while waiting for semaphore, skipping', { episodeId, segmentId });
    await job.updateProgress(100);
    return;
  }

  await job.updateProgress(60);

  // Upload to R2
  const audioUrl = await uploadSegmentAudio(episodeId, segmentId, result.audioBuffer);

  // Update segment with audio URL, duration, and word timings
  await prisma.segment.update({
    where: { id: segmentId },
    data: {
      audioUrl,
      duration: result.segmentDuration,
      wordTimings: result.wordTimings ? JSON.parse(JSON.stringify(result.wordTimings)) : undefined,
    },
  });

  await job.updateProgress(90);

  // Check if all segments for this episode are done
  const pendingSegments = await prisma.segment.count({
    where: { episodeId, audioUrl: null },
  });

  if (pendingSegments === 0) {
    // All segments generated — queue stitching
    const segments = await prisma.segment.findMany({
      where: { episodeId },
      orderBy: { order: 'asc' },
      select: { id: true },
    });

    // Queue stitch with stable jobId (idempotent — BullMQ deduplicates)
    await addJob(
      audioStitchingQueue,
      JobType.STITCH_AUDIO,
      {
        episodeId,
        segmentIds: segments.map((s) => s.id),
      },
      { jobId: `stitch-${episodeId}-${Date.now()}` }
    );

    // CAS status transition — only one worker wins
    const cas = await prisma.episode.updateMany({
      where: { id: episodeId, status: 'GENERATING_AUDIO' },
      data: { status: 'STITCHING' },
    });
    if (cas.count > 0) {
      await invalidateEpisodeCache(episodeId);
      await publishEpisodeStatus(episodeId, { status: 'STITCHING' });
    } else {
      logger.info('Another worker already transitioned to STITCHING', { episodeId });
    }
  }

  await job.updateProgress(100);
  logger.info('Audio generation complete for segment', {
    episodeId,
    segmentId,
    service: result.service,
  });
}
