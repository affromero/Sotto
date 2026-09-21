import { isDeepStrictEqual } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { z } from 'zod';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { optionalSqlWrite } from 'thesidedoor-core/storage/sql';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { restoreStorageBackend } from '@/lib/r2';
import { stitchWithEffects } from '@/lib/audio-stitcher';
import { detectSegmentBoundaries, resolveSegmentStarts } from '@/lib/audio/segment-boundaries';
import { MAX_LESSON_DURATION_MINUTES } from '@/lib/generation-limits';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  validateEpisodeStorage,
  type captureEpisodeStorage,
} from '@/lib/sidedoor/storage/core/episode-storage';
import {
  writeStorageReference,
  storageWriterForBackend,
} from '@/lib/sidedoor/storage/core/storage-write';
import { checkSottoJobStorage } from '@/lib/sidedoor/storage/migration/storage-job-probe';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import type {
  StorageInput,
  validateStorageInputs,
} from '@/lib/sidedoor/storage/core/storage-inputs';
import { generateFingerprint } from '@/lib/audio-fingerprint';
import { isMediaCleanupFailure, rethrowMediaInterruption } from '@/lib/audio/media-process';
import { withSottoJobExecution } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { prepareStitchFailureEffects } from '@/lib/sidedoor/jobs/stitch/stitch-failure-effects';
import { logger } from '@/lib/logger';
import type { InitialStitchOutputs } from '@/lib/sidedoor/jobs/initial/initial-stitch-contract';
import {
  readInitialStitchOutcome,
  writeInitialStitchOutcome,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-outcome';
import {
  buildStitchSoundEffects,
  type StitchSoundExecution,
} from '@/lib/audio/stitch-sound-effects';

type StitchingStorage = Awaited<ReturnType<typeof captureEpisodeStorage>>;
type StitchingEpisode = Pick<
  Prisma.EpisodeGetPayload<{}>,
  'id' | 'userId' | 'title' | 'audioUrl' | 'currentVersion'
> & {
  discovery: { durationTarget: number | null } | null;
  segments: Pick<Prisma.SegmentGetPayload<{}>, 'id' | 'order' | 'duration' | 'ttsVoiceId'>[];
};

export interface StitchingProjection {
  kind: 'initial' | 'incorporation';
  operationId: string;
  fingerprint: string;
  scopes: StitchingStorage['scopes'];
  episode: StitchingEpisode;
  backends: Awaited<ReturnType<typeof validateStorageInputs>>;
  payload: {
    storage: StitchingStorage;
    storageInputs: StorageInput[];
    contributorId: string;
  };
}

class StitchAlreadyComplete extends Error {}

/** Admission readers own generation-specific proof; publication stays atomic here. */
type StitchingOptions = {
  work: StitchingProjection;
  job: Pick<Job<unknown>, 'updateProgress'>;
  stitchKey: string;
  changeType: string;
  interactionId: string | null;
  outputs: InitialStitchOutputs;
  sound: StitchSoundExecution;
  signal?: AbortSignal;
  validatePending: (database: Prisma.TransactionClient) => Promise<boolean>;
  validateAttempt: (database: Prisma.TransactionClient) => Promise<void>;
};

export async function runDurableStitching(options: StitchingOptions): Promise<void> {
  const signal = options.signal ?? new AbortController().signal;
  await withSottoJobExecution({
    database: prisma,
    parentId: options.work.operationId,
    fingerprint: options.work.fingerprint,
    signal,
    validate: options.validatePending,
    isCleanupFailure: isMediaCleanupFailure,
    run: ({ markCleanupUnconfirmed, directory }) =>
      executeDurableStitching({ ...options, signal }, markCleanupUnconfirmed, directory),
  });
}

async function executeDurableStitching(
  {
    work,
    job,
    stitchKey,
    changeType,
    interactionId,
    outputs,
    sound,
    signal = new AbortController().signal,
    validatePending,
    validateAttempt,
  }: StitchingOptions,
  markUnconfirmed: () => void,
  directory: string
): Promise<void> {
  const { payload, episode, operationId, fingerprint: operationFingerprint } = work;
  signal.throwIfAborted();
  const outputBackend = await checkSottoJobStorage({
    database: prisma,
    signal,
    operationId,
    fingerprint: operationFingerprint,
    handler: 'audio-stitching',
    version: work.kind === 'initial' ? 2 : 1,
    instanceId: payload.storage.instanceId,
    scopes: work.scopes,
    validatePending,
  });
  const { versionId } = outputs;
  const version = episode.currentVersion + (episode.audioUrl ? 1 : 0);
  const paths: string[] = [];
  const readers = new Map<string, Awaited<ReturnType<typeof restoreStorageBackend>>>();
  for (const backend of work.backends) {
    if (!readers.has(backend.id))
      readers.set(backend.id, await restoreStorageBackend(backend.descriptor));
  }
  for (const [index, input] of payload.storageInputs.entries()) {
    signal.throwIfAborted();
    const path = join(directory, `segment-${index}.mp3`);
    await readers.get(input.backendId)!.downloadToFile(input.key, path, signal);
    paths.push(path);
  }
  await job.updateProgress(50);
  const soundExecution: StitchSoundExecution =
    sound.policy !== 'elevenlabs'
      ? sound
      : {
          ...sound,
          generate: async (params) => {
            let dispatched = false;
            let settled = false;
            try {
              const audio = await sound.generate({
                ...params,
                onDispatch: () => {
                  dispatched = true;
                },
                onSettled: () => {
                  settled = true;
                },
              });
              if (!dispatched || !settled) {
                markUnconfirmed();
                throw new Error('Sound effect request has no terminal response proof');
              }
              return audio;
            } catch (error) {
              if (dispatched && !settled) markUnconfirmed();
              throw error;
            }
          },
        };
  const sfxInserts = await buildStitchSoundEffects({
    execution: soundExecution,
    directory,
    durations: episode.segments.map((segment) => segment.duration),
    signal,
    progress: (value) => job.updateProgress(value),
  });
  const outputPath = join(directory, 'audio.mp3');
  const { duration } = await stitchWithEffects({
    segmentPaths: paths,
    sfxInserts,
    outputPath,
    crossfadeMs: 300,
    signal,
  });
  signal.throwIfAborted();
  const maxDurationSeconds = MAX_LESSON_DURATION_MINUTES * 60 * 1.1;
  if (duration > maxDurationSeconds) {
    const failureReason = `"${episode.title}" exceeded the ${MAX_LESSON_DURATION_MINUTES}-minute duration limit (${Math.round(duration / 60)} minutes). Please try with a shorter duration target.`;
    const technicalError = `Duration ${Math.round(duration)}s exceeded max ${Math.round(maxDurationSeconds)}s`;
    const failedAt = new Date();
    const effects = prepareStitchFailureEffects({
      operationId,
      fingerprint: operationFingerprint,
      episodeId: episode.id,
      userId: episode.userId,
      contributorId: payload.contributorId,
      storage: payload.storage,
      outputs,
      message: failureReason,
    });
    await sottoTransaction(
      prisma,
      async (tx) => {
        if (!(await validatePending(tx))) return;
        const outbox = sottoJobOutbox(tx);
        if (!(await outbox.complete(operationId, operationFingerprint))) return;
        await tx.episode.update({
          where: { id: episode.id },
          data: {
            status: 'FAILED',
            failedAtStatus: 'STITCHING',
            failureReason,
            technicalError,
            errorId: null,
            failedAt,
            activeStitchKey: null,
            activeStitchOwner: null,
          },
        });
        const published = [];
        for (const effect of effects) {
          const child = await outbox.enqueue(effect);
          published.push({ id: child.job.id, fingerprint: child.fingerprint });
        }
        if (work.kind === 'initial')
          await writeInitialStitchOutcome(
            tx,
            { id: operationId, fingerprint: operationFingerprint },
            {
              kind: 'DURATION_FAILED',
              stitchKey,
              durationSeconds: duration,
              limitSeconds: maxDurationSeconds,
              effects: published,
            }
          );
      },
      { signal }
    );
    await job.updateProgress(100);
    return;
  }
  const starts = resolveSegmentStarts(
    await detectSegmentBoundaries(outputPath, paths, directory, signal),
    episode.segments.map((segment) => segment.duration),
    0.3
  );
  const audio = await readFile(outputPath, { signal });
  const audioFingerprint = await generateFingerprint(outputPath, signal).catch((error: unknown) => {
    rethrowMediaInterruption(error, signal);
    logger.warn('Failed to generate audio fingerprint', {
      episodeId: episode.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  const sideEffects = [
    {
      id: outputs.readyNotification,
      handler: 'notifications',
      payload: {
        userId: episode.userId,
        type: 'EPISODE_READY',
        title: 'Your lesson is ready!',
        message: `"${episode.title}" is ready to play.`,
        data: { episodeId: episode.id },
      },
    },
    {
      id: outputs.pdf,
      handler: 'pdf-generation',
      payload: {
        episodeId: episode.id,
        userId: episode.userId,
        episodeVersion: version,
        stitchKey,
      },
    },
    {
      id: outputs.waveform,
      handler: 'waveform-generation',
      payload: {
        episodeId: episode.id,
        userId: episode.userId,
        episodeVersion: version,
        stitchKey,
      },
    },
    {
      id: outputs.readyStatus,
      handler: 'episode-status',
      payload: { episodeId: episode.id, status: 'READY' },
    },
  ].map((effect) =>
    prepareJob({
      id: effect.id,
      namespace: SIDEDOOR_STATE_ID,
      handler: effect.handler,
      version: 1,
      payload: z.json().parse({
        ...effect.payload,
        parentOperationId: operationId,
        parentFingerprint: operationFingerprint,
        storage: payload.storage,
        contributorId: payload.contributorId,
      }),
      scopes: work.scopes,
      delivery: { attempts: 3, priority: 0, availableAt: 0 },
    })
  );
  async function validate(tx: Prisma.TransactionClient, committedReference?: string) {
    if (!committedReference) {
      if (!(await validatePending(tx))) throw new StitchAlreadyComplete();
      return;
    }
    const receipt = await sottoJobOutbox(tx).read(operationId);
    await validateAttempt(tx);
    const storedVersion = await tx.episodeVersion.findUnique({ where: { id: versionId } });
    const current = await tx.episode.findUnique({ where: { id: episode.id } });
    if (
      !receipt?.complete ||
      receipt.fingerprint !== operationFingerprint ||
      storedVersion?.audioUrl !== committedReference ||
      storedVersion.episodeId !== episode.id ||
      current?.audioUrl !== committedReference ||
      current.currentVersion !== version ||
      current.lastCompletedStitchKey !== stitchKey
    )
      throw new Error('Committed stitch result could not be verified');
    for (const effect of sideEffects) {
      const stored = await sottoJobOutbox(tx).read(effect.id);
      if (!stored || !isDeepStrictEqual(stored.job, effect))
        throw new Error('Committed stitching side effect is missing');
    }
    if (work.kind === 'initial') {
      const outcome = await readInitialStitchOutcome(tx, receipt);
      if (
        outcome.kind !== 'READY' ||
        outcome.audioUrl !== committedReference ||
        outcome.versionId !== versionId ||
        outcome.version !== version ||
        outcome.stitchKey !== stitchKey
      )
        throw new Error('Committed stitching outcome does not match publication');
    }
    await validateEpisodeStorage(tx, episode.id, payload.storage, [payload.contributorId]);
  }
  try {
    await writeStorageReference({
      database: prisma,
      signal,
      writer: storageWriterForBackend(outputBackend),
      prefix: `episodes/${episode.id}/audio`,
      extension: 'mp3',
      contentType: 'audio/mpeg',
      body: audio,
      captureAdmission: async (tx) => {
        await validate(tx);
        return {
          ...payload.storage,
          consumer: `episode:${episode.id}:audio`,
          additionalConsumers: [
            { consumer: `episode-version:${versionId}:audio`, previousReference: null },
          ],
          snapshot: null,
        };
      },
      validateAdmission: (tx, admission, committedReference) => {
        if (admission.consumer !== `episode:${episode.id}:audio`)
          throw new Error('Audio consumer changed');
        return validate(tx, committedReference);
      },
      previousReference: () => episode.audioUrl,
      commit: async (tx, audioUrl) => {
        const outbox = sottoJobOutbox(tx);
        if (!(await outbox.complete(operationId, operationFingerprint)))
          throw new StitchAlreadyComplete();
        await tx.episodeVersion.create({
          data: {
            id: versionId,
            episodeId: episode.id,
            version,
            audioUrl,
            duration: Math.round(duration),
            changeType,
            interactionId,
            segments: {
              create: episode.segments.map((segment, index) => ({
                segmentId: segment.id,
                order: segment.order,
                startTime: starts[index],
                ttsVoiceId: segment.ttsVoiceId,
              })),
            },
          },
        });
        for (const [index, segment] of episode.segments.entries())
          await tx.segment.update({
            where: { id: segment.id },
            data: { startTime: starts[index] },
          });
        await tx.episode.update({
          where: { id: episode.id },
          data: {
            status: 'READY',
            audioUrl,
            duration: Math.round(duration),
            fileSize: audio.length,
            currentVersion: version,
            durationDeviation: episode.discovery?.durationTarget
              ? Math.round(duration) - episode.discovery.durationTarget * 60
              : null,
            lastCompletedStitchKey: stitchKey,
            activeStitchKey: null,
            activeStitchOwner: null,
          },
        });
        await tx.pipelineEvent.create({
          data: {
            episodeId: episode.id,
            stage: 'audio-stitching',
            type: 'complete',
            message: `Pipeline completed, ${Math.round(duration)}s of audio`,
            idempotencyKey: `audio-stitching-complete:${stitchKey}`,
          },
        });
        if (audioFingerprint) {
          const fingerprintWrite = await optionalSqlWrite(
            {
              query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
            },
            () =>
              tx.audioFingerprint.upsert({
                where: { episodeId: episode.id },
                update: audioFingerprint,
                create: { episodeId: episode.id, ...audioFingerprint },
              })
          );
          if (!fingerprintWrite.ok)
            logger.warn('Failed to store audio fingerprint', {
              episodeId: episode.id,
              error:
                fingerprintWrite.error instanceof Error
                  ? fingerprintWrite.error.message
                  : String(fingerprintWrite.error),
            });
        }
        const published = [];
        for (const effect of sideEffects) {
          const child = await outbox.enqueue(effect);
          published.push({ id: child.job.id, fingerprint: child.fingerprint });
        }
        if (work.kind === 'initial')
          await writeInitialStitchOutcome(
            tx,
            { id: operationId, fingerprint: operationFingerprint },
            { kind: 'READY', stitchKey, versionId, version, audioUrl, effects: published }
          );
      },
    });
  } catch (error) {
    if (!(error instanceof StitchAlreadyComplete)) throw error;
  }
  await job.updateProgress(100);
}
