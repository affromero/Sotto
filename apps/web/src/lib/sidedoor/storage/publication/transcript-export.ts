import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AccessError } from 'thesidedoor-core/access';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import type { Prisma } from '@/generated/prisma/client';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import { readEpisodeTranscript } from '@/lib/episodes/episode-transcript';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import {
  captureEpisodeStorage,
  validateEpisodeStorage,
} from '@/lib/sidedoor/storage/core/episode-storage';
import { incorporationPayloadSchema } from '@/lib/sidedoor/jobs/stitch/incorporation-work';
import { readSottoWorkerJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { completeErasedJob } from '@/lib/sidedoor/access/deletion/job-erasure';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

const id = z.string().min(1).max(200);
export class TranscriptExportNotFoundError extends Error {
  constructor() {
    super('Episode not found');
    this.name = 'TranscriptExportNotFoundError';
  }
}
export const transcriptExportPayloadSchema = z
  .object({
    episodeId: id,
    requesterId: id,
    storage: incorporationPayloadSchema.shape.storage,
    delegation: incorporationPayloadSchema.shape.storage,
    source: z.json(),
  })
  .strict();

/** Dates cross the durable JSON boundary as ISO strings. Publication is not source content. */
export function transcriptSource(episode: Awaited<ReturnType<typeof readEpisodeTranscript>>) {
  const source = {
    userId: episode.userId,
    currentVersion: episode.currentVersion,
    lastCompletedStitchKey: episode.lastCompletedStitchKey,
    status: episode.status,
    transcript: episode.transcript,
  };
  return z.json().parse(JSON.parse(JSON.stringify(source)));
}

async function requireExportAccess(
  database: Prisma.TransactionClient,
  episodeId: string,
  requesterId: string
) {
  const episode = await database.episode.findUnique({
    where: { id: episodeId },
    select: { userId: true, visibility: true, status: true, deletedAt: true },
  });
  if (
    !episode ||
    episode.deletedAt ||
    (episode.visibility === 'PRIVATE' && episode.userId !== requesterId)
  )
    throw new TranscriptExportNotFoundError();
  if (episode.status !== 'READY')
    throw new AccessError('invalid', 'Episode must be in READY status to export');
}

/** Original request admission delegates background completion, including after session expiry. */
export async function admitTranscriptExport(
  database: Prisma.TransactionClient,
  options: {
    request: Request;
    admission: AuthenticatedRequest;
    episodeId: string;
    operationId: string;
  }
) {
  const { request, episodeId, operationId } = options;
  const admission = structuredClone(options.admission);
  request.signal.throwIfAborted();
  await requireOriginalSottoAdmission(database, request, admission);
  await requireExportAccess(database, episodeId, admission.userId);
  const storage = await captureEpisodeStorage(database, episodeId);
  const delegation = await captureEpisodeStorage(database, episodeId, [admission.userId]);
  const episode = await readEpisodeTranscript(database, episodeId);
  await requireOriginalSottoAdmission(database, request, admission);
  request.signal.throwIfAborted();
  if (episode.pdfUrl) return { kind: 'ready' as const, pdfUrl: episode.pdfUrl };
  const payload = transcriptExportPayloadSchema.parse({
    episodeId,
    requesterId: admission.userId,
    storage,
    delegation,
    source: transcriptSource(episode),
  });
  const record = await sottoJobOutbox(database).enqueue(
    prepareJob({
      id: operationId,
      namespace: SIDEDOOR_STATE_ID,
      handler: 'pdf-generation',
      version: 2,
      payload,
      scopes: delegation.scopes,
      delivery: { attempts: 3, priority: 0, availableAt: 0 },
    })
  );
  request.signal.throwIfAborted();
  return { kind: 'admitted' as const, record };
}

/** Requester erasure fences the job without making the requester an owner of its output asset. */
export async function readTranscriptExport(
  database: Prisma.TransactionClient,
  queued: {
    id?: string;
    name: string;
    data: unknown;
  }
) {
  const work = await readSottoWorkerJob(database, queued, {
    handler: 'pdf-generation',
    version: 2,
    payload: transcriptExportPayloadSchema,
  });
  if (work.complete) return work;
  const { payload } = work;
  if (
    !isDeepStrictEqual(work.scopes, payload.delegation.scopes) ||
    payload.storage.userId !== payload.delegation.userId
  )
    throw new Error('Transcript export delegation does not match its ownership');
  if (await completeErasedJob(database, work)) return { complete: true as const };
  const episode = await validateTranscriptExport(database, payload);
  return { ...work, episode };
}

/** Also used for lost-publication-response verification after the job is complete. */
export async function validateTranscriptExport(
  database: Prisma.TransactionClient,
  payload: z.infer<typeof transcriptExportPayloadSchema>
) {
  await validateEpisodeStorage(database, payload.episodeId, payload.storage);
  await validateEpisodeStorage(database, payload.episodeId, payload.delegation, [
    payload.requesterId,
  ]);
  await requireExportAccess(database, payload.episodeId, payload.requesterId);
  const episode = await readEpisodeTranscript(database, payload.episodeId);
  if (!isDeepStrictEqual(transcriptSource(episode), payload.source))
    throw new Error('Transcript export inputs changed after admission');
  return episode;
}
