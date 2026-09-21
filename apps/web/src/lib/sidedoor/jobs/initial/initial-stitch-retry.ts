import { AccessError } from 'thesidedoor-core/access';
import type { Prisma } from '@/generated/prisma/client';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { initialStitchPayloadSchema } from '@/lib/sidedoor/jobs/initial/initial-stitch-contract';
import { completeInitialStitchFailure } from '@/lib/sidedoor/jobs/initial/initial-stitch-failure';
import {
  admitInitialStitch,
  requireInitialStitchAttempt,
  type prepareInitialStitchIdentities,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-admission';

/** A verified failed delivery is retried with a fresh canonical identity, never Redis retry(). */
export async function retryInitialStitch(
  database: Prisma.TransactionClient,
  options: {
    request: Request;
    administrator: AuthenticatedRequest;
    operationId: string;
    fingerprint: string;
    identities: ReturnType<typeof prepareInitialStitchIdentities>;
  }
) {
  const { request, operationId, fingerprint } = options;
  const administrator = structuredClone(options.administrator);
  const identities = structuredClone(options.identities);
  request.signal.throwIfAborted();
  await requireOriginalSottoAdmission(database, request, administrator);
  if (!administrator.isOwner) throw new AccessError('forbidden');
  const parent = await sottoJobOutbox(database).read(operationId);
  if (
    !parent ||
    parent.fingerprint !== fingerprint ||
    parent.job.handler !== 'audio-stitching' ||
    parent.job.version !== 2
  )
    throw new AccessError('conflict', 'The stitching retry does not match canonical work');
  const { inputs, soundPolicy } = initialStitchPayloadSchema.parse(parent.job.payload);
  const settled = await completeInitialStitchFailure(
    database,
    { operationId, fingerprint },
    request.signal
  );
  if (settled.kind === 'erased')
    throw new AccessError('conflict', 'The stitching work was deleted');
  if (settled.outcome.kind === 'READY')
    throw new AccessError('conflict', 'The stitching work already completed');
  const current = await database.episode.findUniqueOrThrow({
    where: { id: inputs.episodeId },
    select: { status: true },
  });
  if (current.status === 'READY')
    throw new AccessError('conflict', 'The lesson audio already completed');
  if (current.status === 'FAILED')
    await requireInitialStitchAttempt(database, inputs.episodeId, operationId, fingerprint);
  const result = await admitInitialStitch(database, {
    authorize: async (tx) => {
      await requireOriginalSottoAdmission(tx, request, administrator);
      return { userId: inputs.storage.userId };
    },
    episodeId: inputs.episodeId,
    generationKey: inputs.generationKey,
    soundPolicy,
    identities,
    fromPhase: 'FAILED',
    signal: request.signal,
  });
  if (result.kind === 'waiting')
    throw new AccessError('conflict', 'Some segments still require audio generation');
  return result.record;
}
