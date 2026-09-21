import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import {
  writeReferenceSet,
  type ReferenceSetArtifact,
  type ReferenceSetWriter,
} from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { restoreStorageBackend } from '@/lib/r2';
import { renderWaveformArtifacts } from '@/lib/storage/sidedoor/waveform-artifacts';
import { logger } from '@/lib/logger';
import { readStitchingArtifact } from '@/lib/sidedoor/jobs/stitch/stitching-artifact';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import { validateEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { captureSottoStorageWriter } from '@/lib/sidedoor/storage/core/storage-write';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { withSottoJobExecution } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { isMediaCleanupFailure } from '@/lib/audio/media-process';

type Admission = Exclude<Awaited<ReturnType<typeof readStitchingArtifact>>, { complete: true }>;
class WaveformAlreadyComplete extends Error {}

async function readInputs(database: Prisma.TransactionClient, work: Admission) {
  const { payload } = work;
  const episode = await database.episode.findUniqueOrThrow({
    where: { id: payload.episodeId },
    select: {
      userId: true,
      audioUrl: true,
      currentVersion: true,
      lastCompletedStitchKey: true,
      status: true,
      waveformUrl: true,
      spectrogramUrl: true,
    },
  });
  if (
    episode.userId !== payload.userId ||
    episode.currentVersion !== payload.episodeVersion ||
    episode.lastCompletedStitchKey !== payload.stitchKey ||
    episode.status !== 'READY' ||
    !episode.audioUrl
  )
    throw new Error('Waveform episode version changed');
  const version = await database.episodeVersion.findUnique({
    where: { episodeId_version: { episodeId: payload.episodeId, version: payload.episodeVersion } },
    select: { id: true, audioUrl: true, interactionId: true },
  });
  if (
    !version ||
    version.interactionId !== work.parentInteractionId ||
    version.audioUrl !== episode.audioUrl
  )
    throw new Error('Waveform source version attribution changed');
  const source = await resolveStorageInput(database, {
    consumer: `episode:${payload.episodeId}:audio`,
    reference: episode.audioUrl,
  });
  return { episode, version, source };
}
async function readWork(database: Prisma.TransactionClient, job: Job<unknown>) {
  const work = await readStitchingArtifact(database, job, 'waveform-generation');
  if (work.complete) return work;
  return { ...work, ...(await readInputs(database, work)) };
}

/** Commit both visualizations, their attribution and completion as one artifact set. */
export async function processDurableWaveformGeneration(
  job: Job<unknown>,
  signal: AbortSignal = AbortSignal.timeout(600000)
): Promise<void> {
  signal.throwIfAborted();
  const captured = await sottoTransaction(
    prisma,
    async (tx) => {
      const work = await readWork(tx, job);
      signal.throwIfAborted();
      return work;
    },
    { signal }
  );
  if (captured.complete) {
    await job.updateProgress(100);
    return;
  }
  await withSottoJobExecution({
    database: prisma,
    parentId: captured.operationId,
    fingerprint: captured.fingerprint,
    signal,
    isCleanupFailure: isMediaCleanupFailure,
    validate: async (tx) => {
      const current = await readWork(tx, job);
      signal.throwIfAborted();
      if (current.complete) return false;
      if (!isDeepStrictEqual(current, captured))
        throw new Error('Waveform inputs changed before execution');
      return true;
    },
    run: ({ directory }) => executeWaveformGeneration(job, captured, signal, directory),
  });
}

async function executeWaveformGeneration(
  job: Job<unknown>,
  captured: Exclude<Awaited<ReturnType<typeof readWork>>, { complete: true }>,
  signal: AbortSignal,
  directory: string
) {
  const source = await restoreStorageBackend(captured.source.backend.descriptor);
  const audioPath = join(directory, 'audio.mp3');
  await source.downloadToFile(captured.source.input.key, audioPath, signal);
  await job.updateProgress(30);
  const rendered = await renderWaveformArtifacts(
    audioPath,
    directory,
    (error) => {
      logger.warn('Spectrogram generation failed', {
        episodeId: captured.payload.episodeId,
        error: error instanceof Error ? error.message : String(error),
      });
    },
    signal
  );
  await job.updateProgress(60);
  type Snapshot = typeof captured;
  let writer: Promise<ReferenceSetWriter> | undefined;
  const captureWriter = () => (writer ??= captureSottoStorageWriter());
  const artifacts: ReferenceSetArtifact<Snapshot>[] = [
    {
      name: 'waveform',
      prefix: `episodes/${captured.payload.episodeId}/waveform`,
      extension: 'json',
      contentType: 'application/json',
      body: rendered.waveform,
      captureWriter,
      consumers: (snapshot) => [
        {
          consumer: `episode:${captured.payload.episodeId}:waveform`,
          previousReference: snapshot.episode.waveformUrl,
        },
      ],
    },
  ];
  if (rendered.spectrogram)
    artifacts.push({
      name: 'spectrogram',
      prefix: `episodes/${captured.payload.episodeId}/spectrogram`,
      extension: 'png',
      contentType: 'image/png',
      body: rendered.spectrogram,
      captureWriter,
      consumers: (snapshot) => [
        {
          consumer: `episode:${captured.payload.episodeId}:spectrogram`,
          previousReference: snapshot.episode.spectrogramUrl,
        },
      ],
    });
  const validateCurrent = async (tx: Prisma.TransactionClient) => {
    const current = await readWork(tx, job);
    if (current.complete) throw new WaveformAlreadyComplete();
    if (!isDeepStrictEqual(current, captured))
      throw new Error('Waveform inputs changed during generation');
  };
  try {
    await writeReferenceSet<Prisma.TransactionClient, Snapshot>({
      namespace: SIDEDOOR_STATE_ID,
      dialect: 'postgres',
      signal,
      artifacts,
      transaction: (operation) => sottoTransaction(prisma, operation),
      executor: (tx: Prisma.TransactionClient) => ({
        query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      }),
      captureAdmission: async (tx) => {
        await validateCurrent(tx);
        return {
          instanceId: captured.payload.storage.instanceId,
          scopes: captured.scopes,
          snapshot: captured,
        };
      },
      retirements: (snapshot) =>
        !rendered.spectrogram && snapshot.episode.spectrogramUrl
          ? [
              {
                consumer: `episode:${captured.payload.episodeId}:spectrogram`,
                previousReference: snapshot.episode.spectrogramUrl,
              },
            ]
          : [],
      validateAdmission: async (tx, admission, published) => {
        if (!published) {
          await validateCurrent(tx);
          return;
        }
        const receipt = await sottoJobOutbox(tx).receipt(captured.operationId);
        if (receipt?.status !== 'complete' || receipt.fingerprint !== captured.fingerprint)
          throw new Error('Waveform completion receipt does not match publication');
        await validateEpisodeStorage(tx, captured.payload.episodeId, captured.payload.storage, [
          captured.payload.contributorId,
        ]);
        const current = await readInputs(tx, captured);
        if (
          current.episode.waveformUrl !== published.waveform ||
          current.episode.spectrogramUrl !== (published.spectrogram ?? null) ||
          !isDeepStrictEqual(
            {
              ...current.episode,
              waveformUrl: admission.snapshot.episode.waveformUrl,
              spectrogramUrl: admission.snapshot.episode.spectrogramUrl,
            },
            admission.snapshot.episode
          ) ||
          !isDeepStrictEqual(current.source, admission.snapshot.source) ||
          !isDeepStrictEqual(current.version, admission.snapshot.version)
        )
          throw new Error('Waveform publication cannot be verified');
      },
      commit: async (tx, urls) => {
        signal.throwIfAborted();
        if (!(await sottoJobOutbox(tx).complete(captured.operationId, captured.fingerprint)))
          throw new WaveformAlreadyComplete();
        await tx.episode.update({
          where: { id: captured.payload.episodeId },
          data: { waveformUrl: urls.waveform!, spectrogramUrl: urls.spectrogram ?? null },
        });
      },
    });
  } catch (error) {
    if (!(error instanceof WaveformAlreadyComplete)) throw error;
    if (!(await sottoTransaction(prisma, (tx) => readWork(tx, job))).complete) throw error;
  }
  await job.updateProgress(100);
}
