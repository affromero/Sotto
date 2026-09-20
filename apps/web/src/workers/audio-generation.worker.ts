import { Job } from 'bullmq';
import { GenerateAudioPayload, audioStitchingQueue } from '@/lib/queue';
import { isDeepStrictEqual } from 'node:util';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { resolveTtsProvider } from '@/lib/providers';
import { type TtsProviderId } from '@/lib/providers/tts-registry';
import type { TtsProvider } from '@/lib/providers/tts';
import type { Prisma } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  captureSottoStorageWriter,
  writeStorageReference,
} from '@/lib/sidedoor/storage/core/storage-write';
import {
  captureEpisodeStorage,
  validateEpisodeStorage,
  EpisodeStorageChangedError,
} from '@/lib/sidedoor/storage/core/episode-storage';
import type { VoiceMatchMetadata } from '@/lib/voice-pool';
import { generateTtsAudio } from '@/lib/tts-generation';
import { invalidateEpisodeCache, publishEpisodeStatus } from '@/lib/redis';
import { logger } from '@/lib/logger';
import {
  admitInitialStitch,
  prepareInitialStitchIdentities,
  verifyCurrentInitialStitch,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-admission';
import { deliverSottoJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

export async function processAudioGeneration(
  job: Job<GenerateAudioPayload>,
  signal = new AbortController().signal
): Promise<void> {
  signal.throwIfAborted();
  const stitchIdentities = prepareInitialStitchIdentities();
  const {
    episodeId,
    audioGenerationKey,
    segmentId,
    segmentVersion,
    speaker,
    text,
    previousText,
    nextText,
    direction,
  } = job.data;

  logger.info('Generating audio for segment', { episodeId, segmentId, speaker });
  await job.updateProgress(10);

  // Fail-fast: skip if episode already failed (another segment errored first)
  const episodeStatus = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { status: true, audioGenerationKey: true },
  });

  if (
    !episodeStatus ||
    !['GENERATING_AUDIO', 'STITCHING', 'READY'].includes(episodeStatus.status) ||
    episodeStatus.audioGenerationKey !== audioGenerationKey
  ) {
    logger.info('Skipping invalidated audio generation job', { episodeId, segmentId });
    await job.updateProgress(100);
    return;
  }

  // Idempotency: skip if segment already has audio; also fetch per-segment TTS overrides
  const existingSegment = await prisma.segment.findUnique({
    where: { id: segmentId },
    select: {
      episodeId: true,
      text: true,
      speaker: true,
      version: true,
      audioUrl: true,
      ttsProvider: true,
      ttsModel: true,
      ttsVoiceId: true,
    },
  });
  if (
    !existingSegment ||
    existingSegment.episodeId !== episodeId ||
    existingSegment.version !== segmentVersion ||
    existingSegment.text !== text ||
    existingSegment.speaker !== speaker
  ) {
    logger.info('Skipping stale audio generation job', { episodeId, segmentId, segmentVersion });
    await job.updateProgress(100);
    return;
  }

  const executionOwnership = await sottoTransaction(
    prisma,
    (database) => captureEpisodeStorage(database, episodeId),
    { signal }
  );
  async function authorizeGeneration(database: Prisma.TransactionClient) {
    signal.throwIfAborted();
    await validateEpisodeStorage(database, episodeId, executionOwnership);
    const current = await database.segment.findUnique({
      where: { id: segmentId },
      select: {
        episodeId: true,
        version: true,
        text: true,
        speaker: true,
        episode: { select: { audioGenerationKey: true } },
      },
    });
    if (
      !current ||
      current.episodeId !== episodeId ||
      current.version !== segmentVersion ||
      current.text !== text ||
      current.speaker !== speaker ||
      current.episode.audioGenerationKey !== audioGenerationKey
    )
      throw new EpisodeStorageChangedError();
    return { userId: executionOwnership.userId };
  }
  const admit = (database: Prisma.TransactionClient) =>
    admitInitialStitch(database, {
      authorize: authorizeGeneration,
      episodeId,
      generationKey: audioGenerationKey,
      soundPolicy: 'elevenlabs',
      identities: stitchIdentities,
      fromPhase: 'GENERATING_AUDIO',
      signal,
    });
  async function deliver(admission: Awaited<ReturnType<typeof admit>>) {
    if (admission.kind === 'waiting') return;
    await deliverSottoJob({
      database: prisma,
      queue: audioStitchingQueue,
      operationId: admission.record.job.id,
      fingerprint: admission.record.fingerprint,
      version: 2,
    });
    await invalidateEpisodeCache(episodeId);
    await publishEpisodeStatus(episodeId, { operationId: admission.record.job.id });
  }
  if (existingSegment.audioUrl) {
    logger.info('Segment already has audio, skipping TTS', { episodeId, segmentId });

    await deliver(await sottoTransaction(prisma, admit, { signal }));

    await job.updateProgress(100);
    return;
  }

  if (episodeStatus.status !== 'GENERATING_AUDIO') throw new EpisodeStorageChangedError();

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
  let source: 'credential' | 'local';
  let voiceId: string;
  let expectedVoice = episode.voices.find((voice) => voice.speaker === speaker);
  const segmentSettings = {
    ttsProvider: existingSegment.ttsProvider,
    ttsModel: existingSegment.ttsModel,
    ttsVoiceId: existingSegment.ttsVoiceId,
  };
  const execution: SottoProviderExecution = {
    userId: episode.userId,
    authorize: async (database) => {
      await validateEpisodeStorage(database, episodeId, executionOwnership);
      await readStorageInputs(database);
      return { userId: episode.userId };
    },
  };

  if (existingSegment?.ttsProvider) {
    // ---- Per-segment TTS override (admin showcase builder) ----
    const segProviderId = existingSegment.ttsProvider as TtsProviderId;
    const resolved = await resolveTtsProvider({
      userId: episode.userId,
      execution,
      episodeId,
      requestedProvider: segProviderId,
      requestedModel: existingSegment.ttsModel,
      language: episode.language,
    });
    provider = resolved.provider;
    providerId = resolved.providerId;
    source = resolved.source;

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
      expectedVoice = { speaker, voiceId, provider: providerId };
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
      execution,
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
        .then(() => {
          episode.ttsProvider = providerId;
          episode.ttsModel = ttsModelId;
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
        expectedVoice = { speaker, voiceId, provider: providerId };
      } catch (err) {
        logger.warn('Failed to persist voice assignment', {
          episodeId,
          speaker,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async function readStorageInputs(
    tx: Prisma.TransactionClient,
    committedReference: string | null = null
  ) {
    const segment = await tx.segment.findUnique({
      where: { id: segmentId },
      select: {
        episodeId: true,
        version: true,
        text: true,
        speaker: true,
        audioUrl: true,
        ttsProvider: true,
        ttsModel: true,
        ttsVoiceId: true,
        episode: {
          select: {
            userId: true,
            status: true,
            audioGenerationKey: true,
            language: true,
            ttsProvider: true,
            ttsModel: true,
            voices: { where: { speaker }, select: { voiceId: true, provider: true } },
          },
        },
      },
    });
    const currentVoice = segment?.episode.voices[0];
    if (
      !segment ||
      segment.episodeId !== episodeId ||
      segment.version !== segmentVersion ||
      segment.text !== text ||
      segment.speaker !== speaker ||
      segment.audioUrl !== committedReference ||
      segment.episode.audioGenerationKey !== audioGenerationKey ||
      segment.episode.userId !== episode.userId ||
      segment.episode.language !== episode.language ||
      segment.episode.ttsProvider !== episode.ttsProvider ||
      segment.episode.ttsModel !== episode.ttsModel ||
      segment.ttsProvider !== segmentSettings.ttsProvider ||
      segment.ttsModel !== segmentSettings.ttsModel ||
      segment.ttsVoiceId !== segmentSettings.ttsVoiceId ||
      currentVoice?.voiceId !== expectedVoice?.voiceId ||
      currentVoice?.provider !== expectedVoice?.provider
    )
      throw new EpisodeStorageChangedError();
    if (segment.episode.status !== 'GENERATING_AUDIO') {
      if (!committedReference) throw new EpisodeStorageChangedError();
      const { payload } = await verifyCurrentInitialStitch(
        tx,
        authorizeGeneration,
        episodeId,
        audioGenerationKey,
        signal
      );
      const admitted = payload.inputs.segments.find((item) => item.id === segmentId);
      if (
        !isDeepStrictEqual(payload.inputs.storage, executionOwnership) ||
        !admitted ||
        admitted.version !== segmentVersion ||
        admitted.text !== text ||
        admitted.speaker !== speaker ||
        admitted.audioUrl !== committedReference ||
        admitted.ttsVoiceId !== segment.ttsVoiceId
      )
        throw new EpisodeStorageChangedError();
    }
    return {
      ...segment,
      audioUrl: null,
      episode: { ...segment.episode, status: 'GENERATING_AUDIO' as const },
    };
  }
  const capture = () =>
    sottoTransaction(prisma, async (tx) => ({
      ownership: await captureEpisodeStorage(tx, episodeId),
      inputs: await readStorageInputs(tx),
    }));
  let captured: Awaited<ReturnType<typeof capture>>;
  try {
    captured = await capture();
  } catch (error) {
    if (!(error instanceof EpisodeStorageChangedError)) throw error;
    await job.updateProgress(100);
    return;
  }
  const storageWriter = await captureSottoStorageWriter();
  async function validateStorage(tx: Prisma.TransactionClient, committedReference?: string) {
    await validateEpisodeStorage(tx, episodeId, captured.ownership);
    if (
      JSON.stringify(await readStorageInputs(tx, committedReference)) !==
      JSON.stringify(captured.inputs)
    )
      throw new EpisodeStorageChangedError();
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

  try {
    await writeStorageReference({
      database: prisma,
      signal,
      prefix: `episodes/${episodeId}/segments`,
      extension: 'mp3',
      contentType: 'audio/mpeg',
      body: result.audioBuffer,
      writer: storageWriter,
      captureAdmission: async (tx) => {
        await validateStorage(tx);
        return { ...captured.ownership, consumer: `segment:${segmentId}:audio`, snapshot: null };
      },
      validateAdmission: (tx, admission, committedReference) => {
        if (admission.consumer !== `segment:${segmentId}:audio`)
          throw new EpisodeStorageChangedError();
        return validateStorage(tx, committedReference);
      },
      previousReference: () => null,
      commit: async (tx, audioUrl) => {
        const persisted = await tx.segment.updateMany({
          where: {
            id: segmentId,
            episodeId,
            version: segmentVersion,
            text,
            audioUrl: null,
            episode: {
              status: 'GENERATING_AUDIO',
              audioGenerationKey,
            },
          },
          data: {
            audioUrl,
            duration: result.segmentDuration,
            ...(result.wordTimings
              ? { wordTimings: JSON.parse(JSON.stringify(result.wordTimings)) }
              : {}),
          },
        });
        if (persisted.count !== 1) throw new EpisodeStorageChangedError();
        await admit(tx);
      },
    });
  } catch (error) {
    if (!(error instanceof EpisodeStorageChangedError)) throw error;
    logger.info('Discarding audio generated for stale segment content', {
      episodeId,
      segmentId,
      segmentVersion,
    });
    await job.updateProgress(100);
    return;
  }

  await job.updateProgress(90);

  await deliver(
    await sottoTransaction(
      prisma,
      async (tx) => {
        await authorizeGeneration(tx);
        const current = await tx.episode.findUniqueOrThrow({
          where: { id: episodeId },
          select: { status: true },
        });
        if (current.status === 'GENERATING_AUDIO') return { kind: 'waiting' as const };
        const { record } = await verifyCurrentInitialStitch(
          tx,
          authorizeGeneration,
          episodeId,
          audioGenerationKey,
          signal
        );
        return { kind: 'existing' as const, record };
      },
      { signal }
    )
  );

  await job.updateProgress(100);
  logger.info('Audio generation complete for segment', {
    episodeId,
    segmentId,
    service: result.service,
  });
}
