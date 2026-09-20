import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Job } from 'bullmq';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { optionalSqlWrite } from 'thesidedoor-core/storage/sql';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { resolveTtsProvider } from '@/lib/providers';
import type { TtsProviderId } from '@/lib/providers/tts-registry';
import type { VoiceMatchMetadata } from '@/lib/voice-pool';
import { generateTtsAudio } from '@/lib/tts-generation';
import { logger } from '@/lib/logger';
import {
  storageWriterForBackend,
  writeStorageReference,
} from '@/lib/sidedoor/storage/core/storage-write';
import { readIncorporationWork } from '@/lib/sidedoor/jobs/stitch/incorporation-work';
import { requireIncorporationAttempt } from '@/lib/sidedoor/jobs/stitch/incorporation';
import { validateEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  resolveStorageInput,
  validateStorageInputs,
} from '@/lib/sidedoor/storage/core/storage-inputs';
import { checkSottoJobStorage } from '@/lib/sidedoor/storage/migration/storage-job-probe';
import { withSottoJobExecution } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { isMediaCleanupFailure } from '@/lib/audio/media-process';

class IncorporationAlreadyComplete extends Error {}

/** Durable protocol version 1, admitted against its original incorporation operation. */
export async function processDurableSegmentRegeneration(
  job: Job<unknown>,
  signal: AbortSignal = AbortSignal.timeout(600_000)
): Promise<void> {
  signal.throwIfAborted();
  const work = await sottoTransaction(
    prisma,
    async (tx) => {
      signal.throwIfAborted();
      const current = await readIncorporationWork(tx, job);
      if (current.complete) return current;
      const storageInputs = [];
      for (const segment of current.inputs.episode.segments) {
        if (!segment.audioUrl) throw new Error('Every segment needs audio before incorporation');
        storageInputs.push(
          (
            await resolveStorageInput(tx, {
              consumer: `segment:${segment.id}:audio`,
              reference: segment.audioUrl,
            })
          ).input
        );
      }
      return { ...current, storageInputs };
    },
    { signal }
  );
  if (work.complete) {
    await job.updateProgress(100);
    return;
  }
  await withSottoJobExecution({
    database: prisma,
    parentId: work.operationId,
    fingerprint: work.fingerprint,
    signal,
    isCleanupFailure: isMediaCleanupFailure,
    validate: async (database) => {
      const current = await readIncorporationWork(database, job);
      signal.throwIfAborted();
      if (current.complete) return false;
      const storageInputs = [];
      for (const segment of current.inputs.episode.segments) {
        if (!segment.audioUrl) return false;
        storageInputs.push(
          (
            await resolveStorageInput(database, {
              consumer: `segment:${segment.id}:audio`,
              reference: segment.audioUrl,
            })
          ).input
        );
      }
      return isDeepStrictEqual({ ...current, storageInputs }, work);
    },
    run: ({ markCleanupUnconfirmed, directory }) =>
      executeDurableSegmentRegeneration(job, work, signal, directory, markCleanupUnconfirmed),
  });
}

async function executeDurableSegmentRegeneration(
  job: Job<unknown>,
  work: Exclude<Awaited<ReturnType<typeof readIncorporationWork>>, { complete: true }> & {
    storageInputs: Awaited<ReturnType<typeof resolveStorageInput>>['input'][];
  },
  signal: AbortSignal,
  directory: string,
  markCleanupUnconfirmed: () => void
): Promise<void> {
  const { payload, inputs, operationId, fingerprint, storageInputs: originalStorageInputs } = work;
  const episode = inputs.episode;
  if (!episode.ttsProvider) throw new Error('Select a TTS provider before regenerating audio');
  const outputBackend = await checkSottoJobStorage({
    database: prisma,
    signal,
    operationId,
    fingerprint,
    handler: 'segment-regeneration',
    version: 1,
    instanceId: payload.storage.instanceId,
    scopes: work.scopes,
    validatePending: async (database) => {
      const current = await readIncorporationWork(database, job);
      return (
        !current.complete &&
        current.operationId === operationId &&
        current.fingerprint === fingerprint
      );
    },
  });
  const { provider, source, providerId } = await resolveTtsProvider({
    userId: episode.userId,
    execution: {
      authorize: async (database) => {
        const current = await readIncorporationWork(database, job);
        if (
          current.complete ||
          current.operationId !== operationId ||
          current.fingerprint !== fingerprint
        )
          throw new IncorporationAlreadyComplete();
        if (current.inputs.episode.userId !== episode.userId)
          throw new Error('The incorporation owner changed');
        return { userId: episode.userId };
      },
    },
    episodeId: episode.id,
    requestedProvider: episode.ttsProvider as TtsProviderId,
    requestedModel: episode.ttsModel,
    language: episode.language,
  });
  const assigned = episode.voices.find((voice) => voice.speaker === payload.speaker);
  const metadata = episode.discovery as VoiceMatchMetadata | null;
  const voiceId =
    assigned?.provider === providerId && assigned.voiceId
      ? assigned.voiceId
      : provider.getVoiceId(
          payload.speaker,
          episode.id,
          metadata ?? undefined,
          episode.language ?? undefined
        );
  await job.updateProgress(10);
  let dispatches = 0;
  let settlements = 0;
  let result;
  try {
    result = await generateTtsAudio({
      signal,
      executionDirectory: directory,
      text: payload.newText,
      voiceId,
      speaker: payload.speaker,
      language: episode.language,
      provider,
      providerId,
      source,
      userId: episode.userId,
      episodeId: episode.id,
      requestedModel: episode.ttsModel,
      usageCategory: 'segment_regeneration',
      extraMetadata: { operationId },
      onDispatch: () => dispatches++,
      onSettled: () => settlements++,
      isAborted: async () => {
        const current = await sottoTransaction(prisma, (tx) => readIncorporationWork(tx, job), {
          signal,
        });
        return current.complete;
      },
    });
  } catch (error) {
    if (dispatches !== settlements) markCleanupUnconfirmed();
    throw error;
  }
  if (result && (dispatches === 0 || dispatches !== settlements)) {
    markCleanupUnconfirmed();
    throw new Error('TTS provider request has no terminal response proof');
  }
  if (!result) {
    await job.updateProgress(100);
    return;
  }
  await job.updateProgress(50);
  const segmentId = `regen-${operationId}`;
  const downstreamId = randomUUID();
  const downstreamJob = async (database: Prisma.TransactionClient, audioUrl: string) => {
    const segments = inputs.episode.segments.map((segment) => ({
      id: segment.id,
      version: segment.version,
      audioUrl: segment.audioUrl,
      order: segment.order > payload.insertAfterOrder ? segment.order + 1 : segment.order,
      text: segment.text,
      speaker: segment.speaker,
      duration: segment.duration,
      ttsVoiceId: segment.ttsVoiceId,
    }));
    segments.push({
      id: segmentId,
      version: 1,
      audioUrl,
      order: payload.insertAfterOrder + 1,
      text: payload.newText,
      speaker: payload.speaker,
      duration: result.segmentDuration,
      ttsVoiceId: null,
    });
    segments.sort((left, right) => left.order - right.order);
    if (segments.some((segment) => !segment.audioUrl))
      throw new Error('Every segment needs audio before stitching');
    await validateStorageInputs(database, originalStorageInputs);
    const inserted = await database.segment.findUniqueOrThrow({ where: { id: segmentId } });
    if (inserted.episodeId !== episode.id || inserted.audioUrl !== audioUrl)
      throw new Error('Inserted segment storage reference changed');
    const newInput = (
      await resolveStorageInput(database, {
        consumer: `segment:${segmentId}:audio`,
        reference: audioUrl,
      })
    ).input;
    const storageInputs = segments.map((segment) => {
      const input =
        segment.id === segmentId
          ? newInput
          : originalStorageInputs.find((input) => input.consumer === `segment:${segment.id}:audio`);
      if (!input || input.reference !== segment.audioUrl)
        throw new Error('Segment storage input is missing');
      return input;
    });
    return prepareJob({
      id: downstreamId,
      namespace: SIDEDOOR_STATE_ID,
      handler: 'audio-stitching',
      version: 1,
      payload: {
        episodeId: episode.id,
        interactionId: payload.interactionId,
        parentOperationId: operationId,
        parentFingerprint: fingerprint,
        segmentIds: segments.map((segment) => segment.id),
        segmentVersions: segments.map((segment) => segment.version),
        segmentAudioUrls: segments.map((segment) => segment.audioUrl),
        segmentInputs: segments,
        storageInputs,
        interactionInput: {
          userId: inputs.userId,
          question: inputs.question,
          answer: inputs.answer,
          timestamp: inputs.timestamp,
          visibility: inputs.visibility,
        },
        skipSfx: true,
        storage: payload.storage,
        contributorId: inputs.userId,
        previousAudio: {
          audioUrl: episode.audioUrl,
          currentVersion: episode.currentVersion,
          lastCompletedStitchKey: episode.lastCompletedStitchKey,
        },
      },
      scopes: work.scopes,
      delivery: { attempts: 2, priority: 0, availableAt: 0 },
    });
  };
  async function validate(database: Prisma.TransactionClient, committedReference?: string) {
    if (!committedReference) {
      const current = await readIncorporationWork(database, job);
      if (current.complete) throw new IncorporationAlreadyComplete();
      await validateStorageInputs(database, originalStorageInputs);
      return;
    }
    const record = await sottoJobOutbox(database).read(operationId);
    const downstream = await sottoJobOutbox(database).read(downstreamId);
    const segment = await database.segment.findUnique({ where: { id: segmentId } });
    if (
      !record?.complete ||
      record.fingerprint !== fingerprint ||
      !downstream ||
      !isDeepStrictEqual(downstream.job, await downstreamJob(database, committedReference)) ||
      segment?.episodeId !== episode.id ||
      segment.audioUrl !== committedReference
    )
      throw new Error('The committed incorporation result could not be verified');
    await requireIncorporationAttempt(database, payload.interactionId, operationId, fingerprint);
    await validateEpisodeStorage(database, episode.id, payload.storage, [inputs.userId]);
  }
  try {
    await writeStorageReference({
      database: prisma,
      signal,
      writer: storageWriterForBackend(outputBackend),
      prefix: `episodes/${episode.id}/segments`,
      extension: 'mp3',
      contentType: 'audio/mpeg',
      body: result.audioBuffer,
      captureAdmission: async (database) => {
        await validate(database);
        return { ...payload.storage, consumer: `segment:${segmentId}:audio`, snapshot: null };
      },
      validateAdmission: (database, admission, committedReference) => {
        if (admission.consumer !== `segment:${segmentId}:audio`)
          throw new Error('Storage consumer changed');
        return validate(database, committedReference);
      },
      previousReference: () => null,
      commit: async (database, audioUrl) => {
        const outbox = sottoJobOutbox(database);
        if (!(await outbox.complete(operationId, fingerprint)))
          throw new IncorporationAlreadyComplete();
        const shifted = await database.segment.findMany({
          where: { episodeId: episode.id, order: { gt: payload.insertAfterOrder } },
          orderBy: { order: 'desc' },
          select: { id: true, order: true },
        });
        for (const segment of shifted)
          await database.segment.update({
            where: { id: segment.id },
            data: { order: segment.order + 1 },
          });
        await database.segment.create({
          data: {
            id: segmentId,
            episodeId: episode.id,
            speaker: payload.speaker,
            text: payload.newText,
            order: payload.insertAfterOrder + 1,
            audioUrl,
            duration: result.segmentDuration,
            ...(result.wordTimings
              ? { wordTimings: result.wordTimings.map((timing) => ({ ...timing })) }
              : {}),
          },
        });
        const voiceWrite = await optionalSqlWrite(
          {
            query: (sql, values) =>
              database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          },
          async () => {
            await database.episodeVoice.upsert({
              where: { episodeId_speaker: { episodeId: episode.id, speaker: payload.speaker } },
              create: {
                episodeId: episode.id,
                speaker: payload.speaker,
                voiceId,
                provider: providerId,
              },
              update: { voiceId, provider: providerId },
            });
          }
        );
        if (!voiceWrite.ok) {
          logger.warn('Could not save the incorporation voice assignment', {
            episodeId: episode.id,
            error:
              voiceWrite.error instanceof Error
                ? voiceWrite.error.message
                : String(voiceWrite.error),
          });
        }
        await database.interaction.update({
          where: { id: payload.interactionId },
          data: { status: 'INCORPORATED', incorporated: true },
        });
        await outbox.enqueue(await downstreamJob(database, audioUrl));
        await database.episode.update({ where: { id: episode.id }, data: { status: 'STITCHING' } });
      },
    });
  } catch (error) {
    if (!(error instanceof IncorporationAlreadyComplete)) throw error;
  }
  await job.updateProgress(100);
}
