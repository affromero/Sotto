import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { invalidateEpisodeCache, publishEpisodeStatus } from '@/lib/redis';
import { readSottoWorkerJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { completeErasedJob } from '@/lib/sidedoor/access/deletion/job-erasure';
import { readStitchingParent } from '@/lib/sidedoor/jobs/stitch/stitching-parent';
import { incorporationPayloadSchema } from '@/lib/sidedoor/jobs/stitch/incorporation-work';
import { validateEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

const id = z.string().min(1).max(200);
const payloadSchema = z
  .object({
    episodeId: id,
    status: z.enum(['READY', 'FAILED']),
    parentOperationId: z.uuid(),
    parentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    storage: incorporationPayloadSchema.shape.storage,
    contributorId: id,
  })
  .strict();
type Queued = { id?: string; name: string; data: unknown };

async function readAdmission(database: Prisma.TransactionClient, queued: Queued) {
  const work = await readSottoWorkerJob(database, queued, {
    handler: 'episode-status',
    version: 1,
    payload: payloadSchema,
  });
  if (work.complete) return work;
  const { payload } = work;
  if (!isDeepStrictEqual(work.scopes, payload.storage.scopes))
    throw new Error('Episode invalidation scopes do not match admission');
  const parent = await readStitchingParent(
    database,
    work,
    {
      id: payload.parentOperationId,
      fingerprint: payload.parentFingerprint,
    },
    payload.status === 'READY' ? 'readyStatus' : 'failedStatus'
  );
  if (!parent) return { complete: true as const };
  const { source } = parent;
  if (
    source.episodeId !== payload.episodeId ||
    source.contributorId !== payload.contributorId ||
    !isDeepStrictEqual(source.storage, payload.storage)
  )
    throw new Error('Episode invalidation does not match its parent');
  if (await completeErasedJob(database, work)) return { complete: true as const };
  await validateEpisodeStorage(database, payload.episodeId, payload.storage, [
    payload.contributorId,
  ]);
  return work;
}

/** Delayed delivery requests a fresh read and never assigns a captured episode status. */
export async function processEpisodeStatus(queued: Queued): Promise<void> {
  const captured = await sottoTransaction(prisma, (tx) => readAdmission(tx, queued));
  if (captured.complete) return;
  await invalidateEpisodeCache(captured.payload.episodeId);
  await publishEpisodeStatus(captured.payload.episodeId, {
    kind: 'episode-invalidated',
    episodeId: captured.payload.episodeId,
    operationId: captured.operationId,
  });
  await sottoTransaction(prisma, async (tx) => {
    if (await completeErasedJob(tx, captured)) return;
    const current = await readAdmission(tx, queued);
    if (!current.complete)
      await sottoJobOutbox(tx).complete(current.operationId, current.fingerprint);
  });
}
