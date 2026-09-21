import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { createInitialStitchKey } from '@/lib/audio/stitch-identity';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { initialStitchPayloadSchema } from '@/lib/sidedoor/jobs/initial/initial-stitch-contract';
import { completeErasedJob } from '@/lib/sidedoor/access/deletion/job-erasure';
import { validateEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { verifyCurrentInitialStitch } from '@/lib/sidedoor/jobs/initial/initial-stitch-admission';
import {
  verifyInitialStitchPublication,
  writeInitialStitchOutcome,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-outcome';
import { prepareStitchFailureEffects } from '@/lib/sidedoor/jobs/stitch/stitch-failure-effects';

/** The caller must first verify that this exact Redis delivery is terminal. */
export async function completeInitialStitchFailure(
  database: Prisma.TransactionClient,
  identity: { operationId: string; fingerprint: string },
  signal?: AbortSignal
) {
  const { operationId, fingerprint } = identity;
  const failedAt = new Date();
  signal?.throwIfAborted();
  const outbox = sottoJobOutbox(database);
  const receipt = await outbox.receipt(operationId);
  if (
    !receipt ||
    receipt.fingerprint !== fingerprint ||
    receipt.handler !== 'audio-stitching' ||
    receipt.version !== 2
  )
    throw new Error('Terminal stitching delivery does not match canonical work');
  if (receipt.status === 'erased') return { kind: 'erased' as const };
  const parent = await outbox.read(operationId);
  if (!parent || parent.fingerprint !== fingerprint)
    throw new Error('Terminal stitching work is missing');
  if (parent.complete) {
    const outcome = await verifyInitialStitchPublication(database, parent, signal);
    signal?.throwIfAborted();
    return { kind: 'complete' as const, outcome };
  }
  const { inputs, outputs } = initialStitchPayloadSchema.parse(parent.job.payload);
  if (!isDeepStrictEqual(parent.job.scopes, inputs.storage.scopes))
    throw new Error('Terminal stitching ownership changed');
  if (await completeErasedJob(database, { operationId, fingerprint, scopes: parent.job.scopes }))
    return { kind: 'erased' as const };
  const current = await verifyCurrentInitialStitch(
    database,
    async (tx) => {
      await validateEpisodeStorage(tx, inputs.episodeId, inputs.storage);
      return { userId: inputs.storage.userId };
    },
    inputs.episodeId,
    inputs.generationKey,
    signal
  );
  if (current.record.job.id !== operationId || current.record.fingerprint !== fingerprint)
    throw new Error('Terminal stitching attempt was superseded');
  const message = 'The lesson audio could not be assembled. Retry generation.';
  const effects = prepareStitchFailureEffects({
    operationId,
    fingerprint,
    episodeId: inputs.episodeId,
    userId: inputs.storage.userId,
    contributorId: inputs.storage.userId,
    storage: inputs.storage,
    outputs,
    message,
  });
  if (!(await outbox.complete(operationId, fingerprint)))
    throw new Error('Terminal stitching completion changed');
  await database.episode.update({
    where: { id: inputs.episodeId },
    data: {
      status: 'FAILED',
      failedAtStatus: 'STITCHING',
      failureReason: message,
      technicalError: null,
      errorId: operationId,
      failedAt,
      activeStitchKey: null,
      activeStitchOwner: null,
    },
  });
  await database.pipelineEvent.create({
    data: {
      episodeId: inputs.episodeId,
      stage: 'audio-stitching',
      type: 'error',
      message,
      idempotencyKey: `audio-stitching-failed:${operationId}`,
    },
  });
  const published = [];
  for (const effect of effects) {
    const child = await outbox.enqueue(effect);
    published.push({ id: child.job.id, fingerprint: child.fingerprint });
  }
  const outcome = {
    kind: 'PROCESSING_FAILED' as const,
    stitchKey: createInitialStitchKey(fingerprint),
    failureCode: 'audio_stitching_failed' as const,
    effects: published,
  };
  await writeInitialStitchOutcome(database, { id: operationId, fingerprint }, outcome);
  signal?.throwIfAborted();
  return { kind: 'complete' as const, outcome };
}
