import { isDeepStrictEqual } from 'node:util';
import type { Job } from 'bullmq';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { createStitchKey } from '@/lib/audio/stitch-identity';
import { readSottoWorkerJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import { incorporationPayloadSchema } from '@/lib/sidedoor/jobs/stitch/incorporation-work';
import { requireIncorporationAttempt } from '@/lib/sidedoor/jobs/stitch/incorporation';
import { validateEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  storageInputSchema,
  validateStorageInputs,
} from '@/lib/sidedoor/storage/core/storage-inputs';
import { readJobParent } from '@/lib/sidedoor/access/deletion/job-erasure';
import { runDurableStitching } from '@/workers/durable/audio/durable-stitching-runner';
import { prepareStitchOutputs } from '@/lib/sidedoor/jobs/initial/initial-stitch-contract';

const id = z.string().min(1).max(200);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const segmentInput = z
  .object({
    id,
    version: z.number().int().positive(),
    audioUrl: z.string().min(1),
    order: z.number().int(),
    text: z.string(),
    speaker: id,
    duration: z.number().nonnegative().nullable(),
    ttsVoiceId: z.string().nullable(),
  })
  .strict();
const payloadSchema = z
  .object({
    episodeId: id,
    interactionId: id,
    parentOperationId: z.uuid(),
    parentFingerprint: fingerprint,
    segmentIds: z.array(id).min(1),
    segmentVersions: z.array(z.number().int().positive()),
    segmentAudioUrls: z.array(z.string().min(1)),
    segmentInputs: z.array(segmentInput).min(1),
    storageInputs: z.array(storageInputSchema).min(1),
    interactionInput: z
      .object({
        userId: id,
        question: z.string(),
        answer: z.string().nullable(),
        timestamp: z.number(),
        visibility: z.string(),
      })
      .strict(),
    skipSfx: z.literal(true),
    storage: incorporationPayloadSchema.shape.storage,
    contributorId: id,
    previousAudio: z
      .object({
        audioUrl: z.string().nullable(),
        currentVersion: z.number().int(),
        lastCompletedStitchKey: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

async function readWork(
  database: Prisma.TransactionClient,
  job: Pick<Job<unknown>, 'id' | 'name' | 'data'>,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const work = await readSottoWorkerJob(database, job, {
    handler: 'audio-stitching',
    version: 1,
    payload: payloadSchema,
  });
  if (work.complete) return work;
  const { payload } = work;
  if (!isDeepStrictEqual(work.scopes, payload.storage.scopes))
    throw new Error('Stitching scopes do not match admission');
  const parent = await readJobParent(database, work, {
    id: payload.parentOperationId,
    fingerprint: payload.parentFingerprint,
    handler: 'segment-regeneration',
    version: 1,
  });
  if (!parent) return { complete: true as const };
  if (
    !parent?.complete ||
    parent.fingerprint !== payload.parentFingerprint ||
    parent.job.handler !== 'segment-regeneration'
  )
    throw new Error('Stitching parent operation is not complete');
  await requireIncorporationAttempt(
    database,
    payload.interactionId,
    payload.parentOperationId,
    payload.parentFingerprint
  );
  await validateEpisodeStorage(database, payload.episodeId, payload.storage, [
    payload.contributorId,
  ]);
  const episode = await database.episode.findUniqueOrThrow({
    where: { id: payload.episodeId },
    select: {
      id: true,
      userId: true,
      title: true,
      status: true,
      audioUrl: true,
      currentVersion: true,
      lastCompletedStitchKey: true,
      discovery: { select: { durationTarget: true } },
      segments: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          version: true,
          audioUrl: true,
          order: true,
          text: true,
          speaker: true,
          duration: true,
          ttsVoiceId: true,
        },
      },
    },
  });
  const interaction = await database.interaction.findUniqueOrThrow({
    where: { id: payload.interactionId },
    select: {
      episodeId: true,
      userId: true,
      question: true,
      answer: true,
      timestamp: true,
      visibility: true,
      incorporated: true,
      status: true,
    },
  });
  const currentSegments = episode.segments.map((segment) => ({
    id: segment.id,
    version: segment.version,
    audioUrl: segment.audioUrl,
    order: segment.order,
    text: segment.text,
    speaker: segment.speaker,
    duration: segment.duration,
    ttsVoiceId: segment.ttsVoiceId,
  }));
  if (
    episode.status !== 'STITCHING' ||
    interaction.episodeId !== episode.id ||
    !interaction.incorporated ||
    interaction.status !== 'INCORPORATED' ||
    !isDeepStrictEqual(
      {
        userId: interaction.userId,
        question: interaction.question,
        answer: interaction.answer,
        timestamp: interaction.timestamp,
        visibility: interaction.visibility,
      },
      payload.interactionInput
    ) ||
    !isDeepStrictEqual(
      {
        audioUrl: episode.audioUrl,
        currentVersion: episode.currentVersion,
        lastCompletedStitchKey: episode.lastCompletedStitchKey,
      },
      payload.previousAudio
    ) ||
    !isDeepStrictEqual(currentSegments, payload.segmentInputs) ||
    !isDeepStrictEqual(work.scopes, payload.storage.scopes) ||
    !isDeepStrictEqual(
      episode.segments.map((segment) => segment.id),
      payload.segmentIds
    ) ||
    !isDeepStrictEqual(
      episode.segments.map((segment) => segment.version),
      payload.segmentVersions
    ) ||
    !isDeepStrictEqual(
      episode.segments.map((segment) => segment.audioUrl),
      payload.segmentAudioUrls
    )
  )
    throw new Error('Stitching inputs or ownership changed');
  if (
    payload.storageInputs.length !== episode.segments.length ||
    payload.storageInputs.some(
      (input, index) =>
        input.consumer !== `segment:${episode.segments[index]!.id}:audio` ||
        input.reference !== episode.segments[index]!.audioUrl
    )
  )
    throw new Error('Stitching storage inputs do not match its segments');
  const backends = await validateStorageInputs(database, payload.storageInputs);
  signal?.throwIfAborted();
  return { ...work, episode, backends };
}

/** Incorporation admission feeds the shared atomic stitching publication. */
export async function processDurableAudioStitching(
  job: Pick<Job<unknown>, 'id' | 'name' | 'data' | 'updateProgress'>,
  signal?: AbortSignal
): Promise<void> {
  const work = await sottoTransaction(prisma, (tx) => readWork(tx, job, signal), { signal });
  if (work.complete) {
    await job.updateProgress(100);
    return;
  }
  const { payload, episode } = work;
  await runDurableStitching({
    work: { ...work, kind: 'incorporation' },
    job,
    stitchKey: createStitchKey(episode.id, episode.segments, true),
    changeType: episode.audioUrl ? 'incorporation' : 'initial',
    interactionId: payload.interactionId,
    outputs: prepareStitchOutputs(),
    sound: { policy: 'none' },
    signal,
    validatePending: async (tx) => {
      const current = await readWork(tx, job, signal);
      if (current.complete) return false;
      if (!isDeepStrictEqual(current.episode, episode))
        throw new Error('Episode inputs changed during stitching');
      return true;
    },
    validateAttempt: (tx) =>
      requireIncorporationAttempt(
        tx,
        payload.interactionId,
        payload.parentOperationId,
        payload.parentFingerprint
      ),
  });
}
