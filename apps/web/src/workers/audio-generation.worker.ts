import { Job } from 'bullmq';
import { GenerateAudioPayload, addJob, JobType, audioStitchingQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { resolveTtsProvider, createTtsProviderAsync } from '@/lib/providers';
import { type TtsProviderId } from '@/lib/providers/tts-registry';
import type { TtsProvider } from '@/lib/providers/tts';
import { uploadSegmentAudio } from '@/lib/r2';
import type { VoiceMatchMetadata } from '@/lib/voice-pool';
import { generateTtsAudio, getPlatformTtsKey } from '@/lib/tts-generation';
import { invalidatePodcastCache, publishPodcastStatus } from '@/lib/redis';
import { logger } from '@/lib/logger';

export async function processAudioGeneration(job: Job<GenerateAudioPayload>): Promise<void> {
  const { podcastId, segmentId, speaker, text, previousText, nextText, direction } = job.data;

  logger.info('Generating audio for segment', { podcastId, segmentId, speaker });
  await job.updateProgress(10);

  // Fail-fast: skip if podcast already failed (another segment errored first)
  const podcastStatus = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { status: true },
  });

  if (podcastStatus?.status === 'FAILED') {
    logger.info('Podcast already failed, skipping segment', { podcastId, segmentId });
    await job.updateProgress(100);
    return;
  }

  // Idempotency: skip if segment already has audio; also fetch per-segment TTS overrides
  const existingSegment = await prisma.segment.findUnique({
    where: { id: segmentId },
    select: { audioUrl: true, ttsProvider: true, ttsModel: true, ttsVoiceId: true },
  });

  if (existingSegment?.audioUrl) {
    logger.info('Segment already has audio, skipping TTS', { podcastId, segmentId });

    // Still check if all segments are done — may need to trigger stitching
    const pendingSegments = await prisma.segment.count({
      where: { podcastId, audioUrl: null },
    });

    if (pendingSegments === 0) {
      const segments = await prisma.segment.findMany({
        where: { podcastId },
        orderBy: { order: 'asc' },
        select: { id: true },
      });

      // Queue stitch with stable jobId (idempotent — BullMQ deduplicates)
      await addJob(audioStitchingQueue, JobType.STITCH_AUDIO, {
        podcastId,
        segmentIds: segments.map((s) => s.id),
      }, { jobId: `stitch-${podcastId}` });

      // CAS status transition — only one worker wins
      const cas = await prisma.podcast.updateMany({
        where: { id: podcastId, status: 'GENERATING_AUDIO' },
        data: { status: 'STITCHING' },
      });
      if (cas.count > 0) {
        await invalidatePodcastCache(podcastId);
        await publishPodcastStatus(podcastId, { status: 'STITCHING' });
      } else {
        logger.info('Another worker already transitioned to STITCHING', { podcastId });
      }
    }

    await job.updateProgress(100);
    return;
  }

  // Fetch podcast + user plan to determine voice configuration
  const podcast = await prisma.podcast.findUniqueOrThrow({
    where: { id: podcastId },
    select: {
      userId: true,
      voices: { select: { speaker: true, voiceId: true, provider: true } },
      ttsProvider: true,
      ttsModel: true,
      user: { select: { plan: true } },
    },
  });

  // Fetch discovery metadata for topic-aware voice selection
  const discovery = await prisma.discovery.findUnique({
    where: { podcastId },
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
      where: { podcastId },
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
        const professionalPatterns = /serious|academic|formal|whispering|soft|calm|measured|thoughtful/;
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
    provider = await createTtsProviderAsync(segProviderId, platformKey, undefined, existingSegment.ttsModel ?? undefined);
    providerId = segProviderId;
    source = 'platform';

    voiceId = existingSegment.ttsVoiceId ?? provider.getVoiceId(speaker, podcastId, voiceMetadata);

    // Persist resolved voice for consistency
    try {
      await prisma.podcastVoice.upsert({
        where: { podcastId_speaker: { podcastId, speaker } },
        update: { voiceId, provider: providerId },
        create: { podcastId, speaker, voiceId, provider: providerId },
      });
    } catch (err) {
      logger.warn('Failed to persist voice assignment', {
        podcastId, speaker, error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    // ---- Standard flow: resolve provider at podcast level ----
    const resolved = await resolveTtsProvider({
      userId: podcast.userId,
      podcastId,
      requestedProvider: (podcast.ttsProvider as TtsProviderId | null) ?? undefined,
      requestedModel: podcast.ttsModel,
      plan: podcast.user.plan as 'FREE' | 'PRO',
    });
    provider = resolved.provider;
    providerId = resolved.providerId;
    source = resolved.source;

    const ttsModelId = provider.getModelId();

    // Write back resolved provider and model if not already set
    if (!podcast.ttsProvider || !podcast.ttsModel) {
      await prisma.podcast.update({
        where: { id: podcastId },
        data: { ttsProvider: providerId, ttsModel: ttsModelId },
      }).catch((err) => {
        logger.warn('Failed to write back TTS provider to podcast', { podcastId, error: err instanceof Error ? err.message : String(err) });
      });
    }

    // Use custom voice ID if set and provider matches, otherwise let the provider pick from its pool
    const podcastVoice = podcast.voices.find(v => v.speaker === speaker);
    voiceId = (podcastVoice?.voiceId && podcastVoice.provider === providerId)
      ? podcastVoice.voiceId
      : provider.getVoiceId(speaker, podcastId, voiceMetadata);

    // Persist resolved voice for retry consistency and analytics
    if (!podcastVoice || podcastVoice.provider !== providerId || podcastVoice.voiceId !== voiceId) {
      try {
        await prisma.podcastVoice.upsert({
          where: { podcastId_speaker: { podcastId, speaker } },
          update: { voiceId, provider: providerId },
          create: { podcastId, speaker, voiceId, provider: providerId },
        });
      } catch (err) {
        logger.warn('Failed to persist voice assignment', {
          podcastId, speaker, error: err instanceof Error ? err.message : String(err),
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
    provider,
    providerId,
    source,
    userId: podcast.userId,
    podcastId,
    requestedModel: podcast.ttsModel,
    plan: podcast.user.plan as 'FREE' | 'PRO',
    usageCategory: 'audio_generation',
    isAborted: async () => {
      const check = await prisma.podcast.findUnique({
        where: { id: podcastId },
        select: { status: true },
      });
      return check?.status === 'FAILED';
    },
  });

  if (!result) {
    logger.info('Podcast failed while waiting for semaphore, skipping', { podcastId, segmentId });
    await job.updateProgress(100);
    return;
  }

  await job.updateProgress(60);

  // Upload to R2
  const audioUrl = await uploadSegmentAudio(podcastId, segmentId, result.audioBuffer);

  // Update segment with audio URL and duration
  await prisma.segment.update({
    where: { id: segmentId },
    data: { audioUrl, duration: result.segmentDuration },
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

    // Queue stitch with stable jobId (idempotent — BullMQ deduplicates)
    await addJob(audioStitchingQueue, JobType.STITCH_AUDIO, {
      podcastId,
      segmentIds: segments.map((s) => s.id),
    }, { jobId: `stitch-${podcastId}` });

    // CAS status transition — only one worker wins
    const cas = await prisma.podcast.updateMany({
      where: { id: podcastId, status: 'GENERATING_AUDIO' },
      data: { status: 'STITCHING' },
    });
    if (cas.count > 0) {
      await invalidatePodcastCache(podcastId);
      await publishPodcastStatus(podcastId, { status: 'STITCHING' });
    } else {
      logger.info('Another worker already transitioned to STITCHING', { podcastId });
    }
  }

  await job.updateProgress(100);
  logger.info('Audio generation complete for segment', { podcastId, segmentId, service: result.service });
}
