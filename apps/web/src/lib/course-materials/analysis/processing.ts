import { DelayedError, type Job } from 'bullmq';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { withSottoJobExecution } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  loadDurableQueueJob,
  bindDurableQueueJob,
  completeDurableQueueJob,
  durableJobProviderExecution,
  bindDurableQueueCleanup,
  isDurableQueueCleanupFailure,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import { materialAnalysisPayloadSchema } from './admission';
import { requireMaterialAnalysis, type MaterialAnalysisAuthority } from './persistence';
import {
  captureMaterialAnalysisSource,
  readMaterialAnalysisSourceInventory,
  MaterialAnalysisConflict,
} from './inventory';
import { prepareMaterialFocusAnalysis, materialFocusAnalysisHash } from './protocol';
import { processMaterialAnalysisUnit, MaterialAnalysisOutcomeUnknown } from './units';
import { publishMaterialAnalysis } from './results';

/** Redis waiting never consumes paid attempts or changes the selected extraction run. */
async function defer(job: Job<unknown>, token: string | undefined, delay: number): Promise<never> {
  if (!token)
    throw new MaterialAnalysisConflict('Pending source analysis requires an active queue worker.');
  await job.moveToDelayed(Date.now() + delay, token);
  throw new DelayedError();
}

async function seal(context: MaterialAnalysisAuthority, signal: AbortSignal) {
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const saved = await requireMaterialAnalysis(database, context);
      if (!['WAITING_SOURCE', 'RUNNING'].includes(saved.row.status)) return saved;
      if (saved.prepared) return saved;
      const snapshots = [];
      for (const source of saved.sources) {
        const snapshot = source.inventory
          ? readMaterialAnalysisSourceInventory(source)
          : await captureMaterialAnalysisSource(database, saved.row, source);
        if (!snapshot) return saved;
        snapshots.push(snapshot);
        await database.materialAnalysisSource.update({
          where: { id: source.id },
          data: {
            inventory: snapshot,
            inventoryDigest: materialFocusAnalysisHash(snapshot),
          },
        });
      }
      const course = saved.row.intendedCourseId
        ? await database.course.findUniqueOrThrow({ where: { id: saved.row.intendedCourseId } })
        : null;
      const prepared = prepareMaterialFocusAnalysis({
        owner: { userId: saved.row.userId, generation: Number(saved.row.userGeneration) },
        course: course ? { id: course.id, generation: course.createdAt.getTime() } : null,
        nativeLang: saved.row.nativeLang,
        targetLang: saved.row.targetLang,
        catalog: saved.catalog,
        selection: saved.policy.selection,
        sources: snapshots,
        analyzerVersion: saved.policy.analyzerVersion,
        runtimeRevision: saved.policy.runtimeRevision,
        maxOutputTokens: saved.policy.maxOutputTokens,
        cliBinding: saved.policy.cliBinding,
      });
      await database.materialAnalysis.update({
        where: { id: saved.row.id },
        data: {
          identity: prepared.identity,
          identityDigest: prepared.identityDigest,
          status: 'RUNNING',
          failureReason: null,
        },
      });
      return requireMaterialAnalysis(database, context);
    },
    { signal, timeoutMs: 60000 }
  );
}

/** Bounded leases checkpoint exact chunks. Completed provider work is replayed instead of dispatched. */
export async function processMaterialAnalysis(
  job: Job<unknown>,
  workerSignal?: AbortSignal,
  token?: string
) {
  const signal = workerSignal
    ? AbortSignal.any([workerSignal, AbortSignal.timeout(7_200_000)])
    : AbortSignal.timeout(7_200_000);
  const work = await sottoTransaction(
    prismaUnfiltered,
    (database) => loadDurableQueueJob(database, job, 'material-analysis', 1),
    { signal }
  );
  if (work.complete) return;
  const payload = materialAnalysisPayloadSchema.parse(work.payload.payload);
  const bound = bindDurableQueueJob(job, payload, work);
  const execution = durableJobProviderExecution(bound, payload.userId, signal);
  const context = { analysisId: payload.analysisId, userId: payload.userId, execution };
  const saved = await seal(context, signal);
  if (saved.row.status === 'WAITING_SOURCE') return defer(job, token, 30_000);
  if (['COMPLETE', 'PARTIAL', 'INSUFFICIENT_SOURCE', 'CANCELLED'].includes(saved.row.status)) {
    await sottoTransaction(
      prismaUnfiltered,
      (database) => completeDurableQueueJob(database, bound),
      { signal }
    );
    return;
  }
  if (saved.row.status !== 'RUNNING' || !saved.prepared)
    throw new MaterialAnalysisConflict(
      'This analysis requires explicit recovery before more work.'
    );
  let unknown = false;
  let remaining = false;
  await withSottoJobExecution({
    database: prismaUnfiltered,
    parentId: work.operationId,
    fingerprint: work.fingerprint,
    signal,
    isCleanupFailure: (error) =>
      unknown ||
      error instanceof MaterialAnalysisOutcomeUnknown ||
      isDurableQueueCleanupFailure(error),
    validate: async (database) => {
      const current = await loadDurableQueueJob(database, job, 'material-analysis', 1);
      if (current.complete) return false;
      const analysis = await requireMaterialAnalysis(database, context);
      if (analysis.row.identityDigest !== saved.row.identityDigest)
        throw new MaterialAnalysisConflict('The admitted analysis source identity changed.');
      return analysis.row.status === 'RUNNING';
    },
    run: async ({ markCleanupUnconfirmed }) => {
      bindDurableQueueCleanup(bound, markCleanupUnconfirmed);
      const completed = await prismaUnfiltered.materialAnalysisUnit.findMany({
        where: {
          analysisId: saved.row.id,
          status: { in: ['ANALYZED', 'FAILED', 'OUTPUT_INVALID'] },
        },
        select: { unitKey: true },
      });
      const done = new Set(completed.map((unit) => unit.unitKey));
      const pending = saved.prepared!.units.filter((unit) => !done.has(unit.id));
      const batch = pending.slice(0, 8);
      for (const unit of batch) {
        signal.throwIfAborted();
        await processMaterialAnalysisUnit({
          context,
          analysis: saved.prepared!,
          unit,
          signal,
          unresolved: () => {
            unknown = true;
            markCleanupUnconfirmed();
          },
        });
        await job.updateProgress({
          processedChunks: done.size + batch.indexOf(unit) + 1,
          expectedChunks: saved.prepared!.units.length,
        });
      }
      remaining = pending.length > batch.length;
      if (remaining) return;
      await sottoTransaction(
        prismaUnfiltered,
        async (database) => {
          await publishMaterialAnalysis(database, context);
          await completeDurableQueueJob(database, bound);
        },
        { signal, timeoutMs: 60000 }
      );
    },
  });
  if (remaining) return defer(job, token, 200);
  await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const current = await loadDurableQueueJob(database, job, 'material-analysis', 1);
      if (current.complete) return;
      const analysis = await requireMaterialAnalysis(database, context);
      if (
        ['COMPLETE', 'PARTIAL', 'INSUFFICIENT_SOURCE', 'CANCELLED'].includes(analysis.row.status)
      ) {
        await completeDurableQueueJob(database, bound);
        return;
      }
      throw new MaterialAnalysisConflict(
        'Source analysis stopped before publication and requires explicit settlement.'
      );
    },
    { signal }
  );
}
