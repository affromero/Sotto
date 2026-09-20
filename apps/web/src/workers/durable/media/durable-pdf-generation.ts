import { isDeepStrictEqual } from 'node:util';
import type { Job } from 'bullmq';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { generateEpisodeTranscript } from '@/lib/pdf-generator';
import { readEpisodeTranscript } from '@/lib/episodes/episode-transcript';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { readStitchingArtifact } from '@/lib/sidedoor/jobs/stitch/stitching-artifact';
import { validateEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  readTranscriptExport,
  validateTranscriptExport,
} from '@/lib/sidedoor/storage/publication/transcript-export';
import {
  prepareTranscriptPublication,
  verifyTranscriptPublication,
} from '@/lib/sidedoor/storage/publication/transcript-publication';
import { resolvePublishedStorageReference } from '@/lib/sidedoor/storage/migration/storage-publication';

class TranscriptAlreadyComplete extends Error {}

type TranscriptJob = Pick<Job<unknown>, 'id' | 'name' | 'data' | 'updateProgress'>;

async function readWork(
  database: Prisma.TransactionClient,
  job: TranscriptJob,
  signal: AbortSignal
) {
  if (job.name === 'pdf-generation.v2') {
    const work = await readTranscriptExport(database, job);
    if (work.complete) return work;
    if (work.episode.pdfUrl) {
      if (
        !(await verifyTranscriptPublication(database, work.payload.episodeId, work.episode, signal))
      )
        throw new Error('Concurrent transcript publication cannot be verified');
      await sottoJobOutbox(database).complete(work.operationId, work.fingerprint);
      return { complete: true as const };
    }
    return { ...work, scopes: work.payload.storage.scopes, additionalProfileIds: [] as string[] };
  }
  const work = await readStitchingArtifact(database, job, 'pdf-generation');
  if (work.complete) return work;
  const { payload } = work;
  const episode = await readEpisodeTranscript(database, payload.episodeId);
  if (
    episode.userId !== payload.userId ||
    episode.currentVersion !== payload.episodeVersion ||
    episode.lastCompletedStitchKey !== payload.stitchKey ||
    episode.status !== 'READY'
  )
    throw new Error('Transcript episode version changed');
  return { ...work, episode, additionalProfileIds: [payload.contributorId] };
}

/** Publish the captured transcript and durable completion in the same reference transaction. */
export async function processDurablePdfGeneration(
  job: TranscriptJob,
  signal = new AbortController().signal
): Promise<void> {
  signal.throwIfAborted();
  const inspect = () =>
    sottoTransaction(
      prisma,
      async (tx) => {
        const work = await readWork(tx, job, signal);
        signal.throwIfAborted();
        return work;
      },
      { signal }
    );
  const captured = await inspect();
  if (captured.complete) {
    await job.updateProgress(100);
    return;
  }
  const markdown = generateEpisodeTranscript(captured.episode.transcript);
  await job.updateProgress(30);
  const validateCurrent = async (tx: Prisma.TransactionClient) => {
    const current = await readWork(tx, job, signal);
    if (current.complete) throw new TranscriptAlreadyComplete();
    if (!isDeepStrictEqual(current, captured))
      throw new Error('Transcript inputs changed during generation');
  };
  try {
    await writeStorageReference({
      database: prisma,
      signal,
      prefix: 'transcripts',
      extension: 'md',
      body: Buffer.from(markdown, 'utf8'),
      contentType: 'text/markdown',
      captureAdmission: async (tx) => {
        await validateCurrent(tx);
        return {
          instanceId: captured.payload.storage.instanceId,
          scopes: captured.scopes,
          consumer: `episode:${captured.payload.episodeId}:transcript`,
          snapshot: captured.episode,
        };
      },
      validateAdmission: async (tx, admission, committedReference) => {
        if (!committedReference) {
          await validateCurrent(tx);
          return;
        }
        const receipt = await sottoJobOutbox(tx).receipt(captured.operationId);
        if (receipt?.status !== 'complete' || receipt.fingerprint !== captured.fingerprint)
          throw new Error('Transcript completion receipt does not match publication');
        await validateEpisodeStorage(
          tx,
          captured.payload.episodeId,
          captured.payload.storage,
          captured.additionalProfileIds
        );
        if ('requesterId' in captured.payload) await validateTranscriptExport(tx, captured.payload);
        const episode = await readEpisodeTranscript(tx, captured.payload.episodeId);
        if (
          !episode.pdfUrl ||
          !(await resolvePublishedStorageReference(tx, {
            consumer: `episode:${captured.payload.episodeId}:transcript`,
            originalReference: committedReference,
            currentReference: episode.pdfUrl,
            signal,
          })) ||
          !isDeepStrictEqual(
            { ...episode, pdfUrl: admission.snapshot.pdfUrl },
            admission.snapshot
          ) ||
          !(await verifyTranscriptPublication(tx, captured.payload.episodeId, episode, signal))
        )
          throw new Error('Transcript publication cannot be verified');
      },
      previousReference: (episode) => episode.pdfUrl,
      commit: async (tx, url) => {
        signal.throwIfAborted();
        if (!(await sottoJobOutbox(tx).complete(captured.operationId, captured.fingerprint)))
          throw new TranscriptAlreadyComplete();
        await tx.episode.update({
          where: { id: captured.payload.episodeId },
          data: {
            pdfUrl: url,
            transcriptPublication: prepareTranscriptPublication({
              operationId: captured.operationId,
              fingerprint: captured.fingerprint,
              reference: url,
              episode: captured.episode,
            }),
          },
        });
      },
    });
  } catch (error) {
    if (!(error instanceof TranscriptAlreadyComplete)) throw error;
    const current = await inspect();
    if (!current.complete) throw error;
  }
  signal.throwIfAborted();
  await job.updateProgress(100);
}
