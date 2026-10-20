import { randomUUID } from 'node:crypto';
import {
  materialFocusAnalysisRetryRequestSchema,
  materialFocusAnalysisRetryResponseSchema,
} from '@sotto/shared';
import { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered } from '@/lib/prisma';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  durableQueueOperationId,
  enqueueDurableQueueJob,
  durableEnvelopeSchema,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { materialAnalysisStatusIdentity, materialAnalysisPayloadSchema } from '../admission';
import { readOwnedMaterialAnalysis, readMaterialAnalysisEffectiveUnits } from '../persistence';
import { materialAnalysisUnitReuseSchema } from './reuse';
import { materialFocusAnalysisHash } from '../protocol';
import { materialAnalysisRuntimeRevision } from '../policy';
import { MaterialAnalysisConflict } from '../inventory';

const json = (value: Prisma.JsonValue) => value as Prisma.InputJsonValue;
function response(row: {
  id: string;
  revision: number;
  status: string;
  identityDigest: string | null;
  resultDigest: string | null;
  retryOfAnalysisId: string | null;
  retryCounts: Prisma.JsonValue | null;
}) {
  return materialFocusAnalysisRetryResponseSchema.parse({
    ...materialAnalysisStatusIdentity(row),
    retryOfAnalysisId: row.retryOfAnalysisId,
    counts: row.retryCounts,
  });
}

/** Explicitly fork known settled work. A refresh or request replay never creates another paid invocation. */
export async function retryMaterialAnalysis(
  execution: SottoProviderExecution,
  analysisId: string,
  inputValue: unknown
) {
  const input = materialFocusAnalysisRetryRequestSchema.parse(inputValue);
  const intentDigest = materialFocusAnalysisHash({ kind: 'RETRY', analysisId, ...input });
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== execution.userId)
        throw new MaterialAnalysisConflict('The analysis retry recipient changed.');
      await database.$queryRaw`SELECT id FROM "User" WHERE id = ${execution.userId} FOR UPDATE`;
      const alias = await database.materialAnalysisRequest.findUnique({
        where: { userId_requestId: { userId: execution.userId, requestId: input.requestId } },
        include: { analysis: true },
      });
      if (alias) {
        if (alias.intentDigest !== intentDigest || alias.analysis.retryOfAnalysisId !== analysisId)
          throw new MaterialAnalysisConflict(
            'This request ID already belongs to different analysis work.'
          );
      }
      await database.$queryRaw`SELECT id FROM "MaterialAnalysis" WHERE id = ${analysisId} FOR UPDATE`;
      const parent = await readOwnedMaterialAnalysis(database, {
        analysisId,
        userId: execution.userId,
      });
      if (
        parent.row.revision !== input.analysisRevision ||
        parent.row.identityDigest !== input.identityDigest ||
        parent.row.resultDigest !== input.resultDigest
      )
        throw new MaterialAnalysisConflict(
          'The parent analysis receipt changed. Reload it before retrying.'
        );
      const existingRetry =
        alias?.analysis ??
        (await database.materialAnalysis.findFirst({
          where: { retryOfAnalysisId: parent.row.id, userId: execution.userId },
        }));
      if (existingRetry) {
        const child = await readOwnedMaterialAnalysis(database, {
          analysisId: existingRetry.id,
          userId: execution.userId,
        });
        if (
          child.row.retryOfAnalysisId !== parent.row.id ||
          child.row.userGeneration !== parent.row.userGeneration ||
          child.row.sourceSetDigest !== parent.row.sourceSetDigest ||
          child.row.catalogRevisionId !== parent.row.catalogRevisionId ||
          materialFocusAnalysisHash(child.policy) !== materialFocusAnalysisHash(parent.policy)
        )
          throw new MaterialAnalysisConflict(
            'The existing retry no longer matches its frozen parent.'
          );
        if (!alias)
          await database.materialAnalysisRequest.create({
            data: {
              userId: execution.userId,
              requestId: input.requestId,
              analysisId: child.row.id,
              intentDigest,
            },
          });
        return response(child.row);
      }
      if (!['FAILED', 'PARTIAL', 'INSUFFICIENT_SOURCE', 'CANCELLED'].includes(parent.row.status))
        throw new MaterialAnalysisConflict(
          'Only confirmed failed analysis work can be retried. Unknown outcomes require recovery.'
        );
      if (parent.policy.runtimeRevision !== materialAnalysisRuntimeRevision())
        throw new MaterialAnalysisConflict(
          'This retry requires its original analysis runtime. Start a new analysis under the current policy.'
        );
      const ancestors = new Set([parent.row.id]);
      let previous = parent.row.retryOfAnalysisId;
      while (previous) {
        if (ancestors.has(previous) || ancestors.size >= 63)
          throw new MaterialAnalysisConflict(
            'The explicit retry lineage reached its supported bound.'
          );
        ancestors.add(previous);
        const ancestor = await database.materialAnalysis.findFirst({
          where: {
            id: previous,
            userId: execution.userId,
            userGeneration: parent.row.userGeneration,
          },
          select: { retryOfAnalysisId: true },
        });
        if (!ancestor)
          throw new MaterialAnalysisConflict('The retained retry ancestor is unavailable.');
        previous = ancestor.retryOfAnalysisId;
      }
      const active = await database.materialAnalysis.findFirst({
        where: {
          userId: execution.userId,
          sourceSetDigest: parent.row.sourceSetDigest,
          status: { in: ['WAITING_SOURCE', 'RUNNING', 'RECOVERY_REQUIRED', 'CANCELLING'] },
        },
      });
      if (active)
        throw new MaterialAnalysisConflict(
          'Resume or recover the existing analysis before retrying these sources.'
        );
      const operationId = durableQueueOperationId(
        'material-analysis',
        `material-analysis-${parent.row.id}-${parent.row.revision}`
      );
      const operation = await sottoJobOutbox(database).read(operationId);
      if (
        !operation?.complete ||
        operation.job.handler !== 'material-analysis' ||
        operation.job.version !== 1
      )
        throw new MaterialAnalysisConflict(
          'The parent analysis operation must settle before retry.'
        );
      const envelope = durableEnvelopeSchema.parse(operation.job.payload);
      const authority = envelope.authority;
      const payload = materialAnalysisPayloadSchema.parse(envelope.payload);
      if (
        authority.kind !== 'material-analysis' ||
        authority.analysisId !== parent.row.id ||
        authority.userId !== execution.userId ||
        authority.createdAt !== parent.row.createdAt.getTime() ||
        authority.sourceSetDigest !== parent.row.sourceSetDigest ||
        payload.analysisId !== parent.row.id ||
        payload.userId !== execution.userId
      )
        throw new MaterialAnalysisConflict(
          'The parent operation does not match its frozen analysis authority.'
        );
      try {
        await sottoJobExecutions(database).requireParentDrained(operationId, operation.fingerprint);
      } catch {
        throw new MaterialAnalysisConflict(
          'The parent executor cleanup is unconfirmed. Recover it before retrying.'
        );
      }
      const raw = await database.materialAnalysisUnit.findMany({
        where: { analysisId: parent.row.id },
        orderBy: { unitKey: 'asc' },
      });
      if (raw.some((unit) => ['UNKNOWN', 'DISPATCHING'].includes(unit.status)))
        throw new MaterialAnalysisConflict(
          'An admitted source request has an unknown outcome and cannot be retried.'
        );
      const units = parent.prepared
        ? await readMaterialAnalysisEffectiveUnits(database, {
            analysisId: parent.row.id,
            userId: execution.userId,
            execution,
          })
        : [];
      const counts = {
        inherited: 0,
        analyzed: 0,
        offlineReplay: 0,
        failed: 0,
        unstarted: Math.max(0, (parent.prepared?.units.length ?? 0) - raw.length),
      };
      for (const unit of units) {
        if (unit.status === 'ANALYZED') {
          counts.inherited++;
          counts.analyzed++;
        } else if (unit.status === 'SUCCEEDED') {
          counts.inherited++;
          counts.offlineReplay++;
        } else if (['FAILED', 'OUTPUT_INVALID'].includes(unit.status)) counts.failed++;
        else if (unit.status === 'READY' && !unit.attemptId) counts.unstarted++;
        else throw new MaterialAnalysisConflict('A unit has no proven retry or reuse outcome.');
      }
      if (
        parent.prepared &&
        parent.row.status !== 'CANCELLED' &&
        !counts.failed &&
        !counts.unstarted &&
        !counts.offlineReplay
      )
        throw new MaterialAnalysisConflict(
          'No failed source requests remain. Unresolved page coverage needs a new processed source revision.',
          422
        );
      const id = randomUUID();
      const child = await database.materialAnalysis.create({
        data: {
          id,
          userId: parent.row.userId,
          userGeneration: parent.row.userGeneration,
          nativeLang: parent.row.nativeLang,
          targetLang: parent.row.targetLang,
          intendedCourseId: parent.row.intendedCourseId,
          attachedCourseId: parent.row.attachedCourseId,
          purpose: parent.row.purpose,
          requestId: input.requestId,
          retryOfAnalysisId: parent.row.id,
          retryCounts: counts,
          admissionDigest: materialFocusAnalysisHash({
            kind: 'RETRY',
            parentId: parent.row.id,
            intentDigest,
          }),
          sourceSetDigest: parent.row.sourceSetDigest,
          catalogRevisionId: parent.row.catalogRevisionId,
          policy: json(parent.row.policy),
          ...(parent.row.identity
            ? { identity: json(parent.row.identity), identityDigest: parent.row.identityDigest }
            : {}),
          status: parent.prepared ? 'RUNNING' : 'WAITING_SOURCE',
          sources: {
            create: parent.sources.map((source) => ({
              sourceId: source.sourceId,
              order: source.order,
              kind: source.kind,
              name: source.name,
              materialId: source.materialId,
              materialGeneration: source.materialGeneration,
              runId: source.runId,
              processingRevision: source.processingRevision,
              originalSha256: source.originalSha256,
              snapshotBytes: source.snapshotBytes ? Uint8Array.from(source.snapshotBytes) : null,
              snapshotSha256: source.snapshotSha256,
              noteId: source.noteId,
              noteGeneration: source.noteGeneration,
              revision: source.revision,
              ...(source.inventory
                ? { inventory: json(source.inventory), inventoryDigest: source.inventoryDigest }
                : {}),
            })),
          },
        },
      });
      for (const unit of units) {
        if (!['ANALYZED', 'SUCCEEDED'].includes(unit.status)) continue;
        const reuse = materialAnalysisUnitReuseSchema.parse({
          schemaVersion: 1,
          sourceAnalysisId: parent.row.id,
          sourceUnitId: unit.id,
          sourceIdentityDigest: unit.identityDigest,
          sourceInputDigest: unit.inputDigest,
          sourceStatus: unit.status,
          attemptId: unit.attemptId,
          attemptFingerprint: unit.attemptFingerprint,
          responseKind: unit.responseKind,
          responseSha256: unit.responseSha256,
          outputSha256: unit.outputSha256,
        });
        const identity = { ...(unit.identity as Prisma.JsonObject), analysisId: id };
        await database.materialAnalysisUnit.create({
          data: {
            analysisId: id,
            stage: unit.stage,
            unitKey: unit.unitKey,
            identity,
            identityDigest: materialFocusAnalysisHash(identity),
            inputDigest: unit.inputDigest,
            mode: unit.mode,
            status: unit.status,
            reuse,
          },
        });
      }
      await database.materialAnalysisRequest.create({
        data: {
          userId: execution.userId,
          requestId: input.requestId,
          analysisId: id,
          intentDigest,
        },
      });
      await enqueueDurableQueueJob(database, {
        handler: 'material-analysis',
        type: 'analyze_material_sources',
        payload: materialAnalysisPayloadSchema.parse({ userId: execution.userId, analysisId: id }),
        jobId: `material-analysis-${id}-${child.revision}`,
        attempts: 2,
      });
      return response(child);
    },
    { signal: execution.signal, timeoutMs: 60000 }
  );
}
