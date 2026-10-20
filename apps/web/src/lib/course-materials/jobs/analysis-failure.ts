import type { Job } from 'bullmq';
import type { Prisma } from '@/generated/prisma/client';
import { completeErasedJob } from '@/lib/sidedoor/access/deletion/job-erasure';
import { sottoJobOutbox, readSottoWorkerJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import { durableEnvelopeSchema } from '@/lib/sidedoor/jobs/core/durable-queue';
import { sottoStorageInstance } from '@/lib/sidedoor/access/state/store';

/** Missed worker events reconcile the same explicit failed analysis/session projection. */
export async function settleAnalysisFailure(
  database: Prisma.TransactionClient,
  reference: { operationId: string; fingerprint: string; handler: string; version: number }
) {
  if (
    !['material-analysis', 'placement-generation'].includes(reference.handler) ||
    reference.version !== 1
  )
    throw new Error('Unsupported source analysis failure contract.');
  const outbox = sottoJobOutbox(database),
    work = await outbox.read(reference.operationId);
  if (
    !work ||
    work.fingerprint !== reference.fingerprint ||
    work.job.handler !== reference.handler ||
    work.job.version !== 1
  )
    throw new Error('The analysis failure does not match its immutable outbox receipt.');
  if (
    work.complete ||
    (await completeErasedJob(database, {
      operationId: reference.operationId,
      fingerprint: reference.fingerprint,
      scopes: work.job.scopes,
    }))
  )
    return;
  const envelope = durableEnvelopeSchema.parse(work.job.payload),
    authority = envelope.authority;
  // A stale source can explain failure. Never authorize more dispatch while settling it.
  const expectedKind =
    reference.handler === 'material-analysis' ? 'material-analysis' : 'placement-session';
  if (authority.kind !== expectedKind)
    throw new Error('The failed analysis job has no exact entity authority.');
  if (authority.kind !== 'material-analysis' && authority.kind !== 'placement-session')
    throw new Error('Unsupported failure authority.');
  const instance = await sottoStorageInstance(database).read();
  const profile = await database.user.findUnique({
    where: { id: authority.userId },
    select: { createdAt: true },
  });
  if (
    instance.instanceId !== authority.instanceId ||
    !profile ||
    !authority.scopes.some(
      (scope) =>
        scope.subjectId === `profile:${authority.userId}` &&
        scope.generation === profile.createdAt.getTime()
    )
  )
    throw new Error('The failed analysis owner or instance generation changed.');
  if (authority.kind === 'material-analysis') {
    const analysis = await database.materialAnalysis.findFirst({
      where: {
        id: authority.analysisId,
        userId: authority.userId,
        createdAt: new Date(authority.createdAt),
        sourceSetDigest: authority.sourceSetDigest,
      },
    });
    if (!analysis) throw new Error('A missing analysis requires canonical erasure proof.');
    if (analysis.status === 'CANCELLING') return;
    if (!['COMPLETE', 'PARTIAL', 'INSUFFICIENT_SOURCE', 'CANCELLED'].includes(analysis.status)) {
      const unknown = await database.materialAnalysisUnit.findFirst({
        where: { analysisId: analysis.id, status: { in: ['DISPATCHING', 'UNKNOWN'] } },
        select: { id: true },
      });
      await database.materialAnalysis.update({
        where: { id: analysis.id },
        data: {
          status: unknown ? 'RECOVERY_REQUIRED' : 'FAILED',
          completedAt: new Date(),
          failureReason: unknown
            ? 'An admitted source-analysis request has an unknown outcome. Saved responses and originals remain retained.'
            : 'Source analysis stopped before complete publication. Saved results and originals remain retained. Review the source and processing configuration before a new analysis.',
        },
      });
    }
  } else if (authority.kind === 'placement-session') {
    const session = await database.placementSession.findFirst({
      where: {
        id: authority.placementSessionId,
        userId: authority.userId,
        createdAt: new Date(authority.createdAt),
        inputDigest: authority.inputDigest,
      },
    });
    if (!session) throw new Error('A missing placement session requires canonical erasure proof.');
    if (!['READY', 'ACCEPTED', 'SUBMITTED', 'CANCELLED'].includes(session.status))
      await database.placementSession.update({
        where: { id: session.id },
        data: {
          status: session.attemptId && !session.responseBytes ? 'RECOVERY_REQUIRED' : 'FAILED',
          failureReason:
            'Placement preparation stopped. Its admitted request and saved response remain retained for review.',
        },
      });
  }
  await outbox.complete(reference.operationId, reference.fingerprint);
}

export async function settleFailedAnalysisJob(
  database: Prisma.TransactionClient,
  job: Job<unknown>,
  handler: 'material-analysis' | 'placement-generation'
) {
  const work = await readSottoWorkerJob(database, job, {
    handler,
    version: 1,
    payload: durableEnvelopeSchema,
  });
  if (!work.complete)
    await settleAnalysisFailure(database, {
      operationId: work.operationId,
      fingerprint: work.fingerprint,
      handler,
      version: 1,
    });
}
