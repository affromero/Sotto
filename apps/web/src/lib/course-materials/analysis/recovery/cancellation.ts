import {
  materialAnalysisCancellationRequestSchema,
  materialAnalysisCancellationResponseSchema,
  type MaterialAnalysisCancellationBlocker,
} from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered } from '@/lib/prisma';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  durableEnvelopeSchema,
  durableQueueOperationId,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import { materialAnalysisPayloadSchema, materialAnalysisStatusIdentity } from '../admission';
import { MaterialAnalysisConflict } from '../inventory';
import { materialFocusAnalysisHash } from '../protocol';
import {
  verifyMaterialAnalysisCancellationUnits,
  type MaterialAnalysisAuthority,
} from '../persistence';
import { validateMaterialAnalysisJobAuthority } from '../../jobs/analysis-authority';

const immutable = new Set([
  'COMPLETE',
  'PARTIAL',
  'INSUFFICIENT_SOURCE',
  'CANCELLED',
  'SUPERSEDED',
]);

/** Cancellation owns the original entity and immutable outbox, without granting processing authority. */
async function owned(database: Prisma.TransactionClient, context: MaterialAnalysisAuthority) {
  const actor = await context.execution.authorize(database);
  if (actor.userId !== context.userId || context.execution.userId !== context.userId)
    throw new MaterialAnalysisConflict('The cancellation recipient changed.');
  await database.$queryRaw`SELECT id FROM "User" WHERE id = ${context.userId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "MaterialAnalysis" WHERE id = ${context.analysisId} FOR UPDATE`;
  const row = await database.materialAnalysis.findFirst({
    where: { id: context.analysisId, userId: context.userId },
  });
  if (!row) throw new MaterialAnalysisConflict('Analysis not found.', 404);
  const user = await database.user.findUniqueOrThrow({
    where: { id: context.userId },
    select: { createdAt: true },
  });
  if (BigInt(user.createdAt.getTime()) !== row.userGeneration)
    throw new MaterialAnalysisConflict('The original analysis owner generation changed.');
  const operationId = durableQueueOperationId(
    'material-analysis',
    `material-analysis-${row.id}-${row.revision}`
  );
  const operation = await sottoJobOutbox(database).read(operationId);
  if (!operation || operation.job.handler !== 'material-analysis' || operation.job.version !== 1)
    throw new MaterialAnalysisConflict('The original analysis operation is unavailable.');
  const envelope = durableEnvelopeSchema.parse(operation.job.payload);
  const payload = materialAnalysisPayloadSchema.parse(envelope.payload);
  const authority = envelope.authority;
  const instance = await sottoStorageInstance(database).read();
  if (
    authority.kind !== 'material-analysis' ||
    authority.analysisId !== row.id ||
    authority.userId !== row.userId ||
    authority.createdAt !== row.createdAt.getTime() ||
    authority.sourceSetDigest !== row.sourceSetDigest ||
    authority.instanceId !== instance.instanceId ||
    payload.analysisId !== row.id ||
    payload.userId !== row.userId
  )
    throw new MaterialAnalysisConflict(
      'The cancellation does not match the original analysis operation.'
    );
  return { row, operationId, operation, authority };
}

async function receipt(
  database: Prisma.TransactionClient,
  work: Awaited<ReturnType<typeof owned>>,
  blockers: MaterialAnalysisCancellationBlocker[]
) {
  const verifiedUnits = await database.materialAnalysisUnit.count({
    where: { analysisId: work.row.id, cancellationVerifiedAt: { not: null } },
  });
  const remainingUnits = await database.materialAnalysisUnit.count({
    where: { analysisId: work.row.id, cancellationVerifiedAt: null },
  });
  return materialAnalysisCancellationResponseSchema.parse({
    ...materialAnalysisStatusIdentity(work.row),
    cancellation: {
      state:
        work.row.status === 'CANCELLED'
          ? 'CANCELLED'
          : work.row.status === 'CANCELLING'
            ? 'PENDING'
            : 'NOT_NEEDED',
      verifiedUnits,
      remainingUnits,
      hasMore: blockers.length === 1 && blockers[0] === 'VERIFICATION_PENDING',
      blockers,
      operationId: work.operationId,
      operatorRecoveryUrl: null,
    },
  });
}

/** One bounded verification page. No provider, process termination, Redis retry or forced drain. */
export async function settleMaterialAnalysisCancellation(
  database: Prisma.TransactionClient,
  context: MaterialAnalysisAuthority
) {
  const work = await owned(database, context);
  if (work.row.status !== 'CANCELLING') return receipt(database, work, []);
  const blockers: MaterialAnalysisCancellationBlocker[] = [];
  const [admitted, unknown] = await Promise.all([
    database.materialAnalysisUnit.findFirst({
      where: { analysisId: work.row.id, status: 'DISPATCHING' },
      select: { id: true },
    }),
    database.materialAnalysisUnit.findFirst({
      where: { analysisId: work.row.id, status: 'UNKNOWN' },
      select: { id: true },
    }),
  ]);
  if (admitted) blockers.push('PROVIDER_ADMITTED');
  if (unknown) blockers.push('PROVIDER_UNKNOWN');
  const journal = sottoJobExecutions(database);
  const blocking = await journal.blockingStatus(work.operationId, work.operation.fingerprint);
  if (blocking) blockers.push(blocking === 'active' ? 'EXECUTOR_ACTIVE' : 'CLEANUP_UNCONFIRMED');
  if (blockers.length) return receipt(database, work, blockers);
  try {
    await journal.requireParentDrained(work.operationId, work.operation.fingerprint);
    await validateMaterialAnalysisJobAuthority(database, work.authority);
    const units = await database.materialAnalysisUnit.findMany({
      where: { analysisId: work.row.id, cancellationVerifiedAt: null },
      orderBy: { id: 'asc' },
      take: 64,
      select: { id: true },
    });
    if (units.length)
      await verifyMaterialAnalysisCancellationUnits(
        database,
        context,
        units.map((unit) => unit.id)
      );
  } catch {
    return receipt(database, work, ['PROOF_UNAVAILABLE']);
  }
  const remaining = await database.materialAnalysisUnit.count({
    where: { analysisId: work.row.id, cancellationVerifiedAt: null },
  });
  if (remaining) return receipt(database, work, ['VERIFICATION_PENDING']);
  await journal.requireParentDrained(work.operationId, work.operation.fingerprint);
  work.row = await database.materialAnalysis.update({
    where: { id: work.row.id },
    data: {
      status: 'CANCELLED',
      completedAt: new Date(),
      failureReason:
        'Analysis cancelled. Original materials and saved provider receipts remain retained.',
    },
  });
  await sottoJobOutbox(database).complete(work.operationId, work.operation.fingerprint);
  return receipt(database, work, []);
}

/** The stop fence commits before proof work, so an unavailable proof never reopens admission. */
export async function requestMaterialAnalysisCancellation(
  execution: SottoProviderExecution,
  analysisId: string,
  inputValue: unknown
) {
  const input = materialAnalysisCancellationRequestSchema.parse(inputValue);
  const intentDigest = materialFocusAnalysisHash({
    kind: 'CANCEL_MATERIAL_ANALYSIS',
    analysisId,
    ...input,
  });
  const context = { execution, analysisId, userId: execution.userId };
  const terminal = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const work = await owned(database, context);
      if (
        work.row.revision !== input.analysisRevision ||
        work.row.identityDigest !== input.identityDigest ||
        work.row.resultDigest !== input.resultDigest
      )
        throw new MaterialAnalysisConflict(
          'The observed analysis receipt changed. Reload before cancelling.'
        );
      const alias = await database.materialAnalysisRequest.findUnique({
        where: { userId_requestId: { userId: execution.userId, requestId: input.requestId } },
      });
      if (alias && (alias.analysisId !== analysisId || alias.intentDigest !== intentDigest))
        throw new MaterialAnalysisConflict('This request ID already belongs to different work.');
      if (!alias)
        await database.materialAnalysisRequest.create({
          data: { userId: execution.userId, requestId: input.requestId, analysisId, intentDigest },
        });
      if (immutable.has(work.row.status)) return receipt(database, work, []);
      if (work.row.status !== 'CANCELLING')
        await database.materialAnalysis.update({
          where: { id: analysisId },
          data: {
            status: 'CANCELLING',
            failureReason:
              'Cancellation requested. The current provider attempt may finish; future chunks are stopped.',
          },
        });
      return null;
    },
    { signal: execution.signal, timeoutMs: 60000 }
  );
  if (terminal) return terminal;
  return sottoTransaction(
    prismaUnfiltered,
    (database) => settleMaterialAnalysisCancellation(database, context),
    { signal: execution.signal, timeoutMs: 60000 }
  );
}
