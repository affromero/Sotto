import type { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { createNextClass } from '@/lib/class-service';
import { ClassSourceError } from '@/lib/class-source';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { readSottoWorkerJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { withSottoJobExecution } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { isDurableQueueCleanupFailure } from '@/lib/sidedoor/jobs/core/durable-queue';
import {
  CLASS_PREPARATION_QUEUE,
  classPreparationPayload,
  classPreparationStore,
  validateClassPreparation,
  recordClassPreparationFailure,
} from '@/lib/classes/preparation';
import { PreparationConflictError, startPreparation } from '@/lib/classes/preparation-state';
import { classPreparationGrant } from '@/lib/classes/preparation-grant';
import { preparationProviderRequest } from '@/lib/classes/preparation-provider';
import { registerPreparationAudio } from '@/lib/classes/preparation-audio';

/** A crashed generation is fenced as unresolved; replay never repeats unproven external work. */
export async function processClassPreparation(job: Job<unknown>, workerSignal?: AbortSignal) {
  const work = await sottoTransaction(prisma, (database) =>
    readSottoWorkerJob(database, job, {
      handler: CLASS_PREPARATION_QUEUE,
      version: 1,
      payload: classPreparationPayload,
    })
  );
  if (work.complete) return;
  const { courseId, operationId } = work.payload;
  if (operationId !== work.operationId)
    throw new PreparationConflictError('Preparation identity changed.');
  const controller = new AbortController();
  const signal = workerSignal
    ? AbortSignal.any([workerSignal, controller.signal])
    : controller.signal;
  let outcomeUnknown = false;
  await withSottoJobExecution({
    database: prisma,
    parentId: work.operationId,
    fingerprint: work.fingerprint,
    signal,
    isCleanupFailure: (error) => outcomeUnknown || isDurableQueueCleanupFailure(error),
    validate: async (database) => {
      const current = await readSottoWorkerJob(database, job, {
        handler: CLASS_PREPARATION_QUEUE,
        version: 1,
        payload: classPreparationPayload,
      });
      if (current.complete) return false;
      await validateClassPreparation(database, courseId, operationId, true);
      return true;
    },
    run: async ({ markCleanupUnconfirmed, directory }) => {
      const operation = await sottoTransaction(prisma, async (database) => {
        await validateClassPreparation(database, courseId, operationId, true);
        return classPreparationStore(database, courseId).transact((current) => {
          if (!current || current.id !== operationId) throw new PreparationConflictError();
          Object.assign(current, startPreparation(current, Date.now()));
          return current;
        });
      });
      if (operation.status !== 'RUNNING') {
        await sottoTransaction(prisma, async (database) => {
          if (operation.status !== 'COMPLETED')
            await classPreparationGrant(database, operation).revoke(operation.grant);
          await sottoJobOutbox(database).complete(operationId, work.fingerprint);
        });
        return;
      }
      let checking = false;
      const check = async () => {
        if (checking || signal.aborted) return;
        checking = true;
        try {
          await sottoTransaction(prisma, (database) =>
            validateClassPreparation(database, courseId, operationId)
          );
        } catch (error) {
          controller.abort(error);
        } finally {
          checking = false;
        }
      };
      const timer = setInterval(() => {
        void check();
      }, 500);
      const authorize = async (database: Parameters<typeof validateClassPreparation>[0]) => {
        signal.throwIfAborted();
        const current = await validateClassPreparation(database, courseId, operationId);
        return { userId: current.userId };
      };
      try {
        const result = await createNextClass(
          courseId,
          operation.userId,
          {
            userId: operation.userId,
            authorize,
            signal,
            onCleanupError: markCleanupUnconfirmed,
            learningSelection: operation.selection,
            isolatedWorkspace: { directory, markCleanupUnconfirmed },
            registerAudioEpisode: (database, episodeId, audioGenerationKey) =>
              registerPreparationAudio(database, operation, episodeId, audioGenerationKey),
            ...(operation.maxProviderRequests === null
              ? {}
              : {
                  providerRequest: preparationProviderRequest(operation, signal, () => {
                    outcomeUnknown = true;
                    markCleanupUnconfirmed();
                  }),
                }),
          },
          { sourceUrl: work.payload.sourceUrl, topic: work.payload.topic },
          {
            deferAudio: operation.deferAudio,
            create: (data) =>
              sottoTransaction(
                prisma,
                async (database) => {
                  await authorize(database);
                  const cls = await database.courseClass.create({
                    data: { ...data, id: operationId },
                  });
                  await classPreparationStore(database, courseId).transact((current) => {
                    if (!current || current.id !== operationId)
                      throw new PreparationConflictError();
                    current.classId = cls.id;
                    current.updatedAt = Date.now();
                  });
                  return cls;
                },
                { signal }
              ),
            publish: (classId, adaptiveSeed) =>
              sottoTransaction(
                prisma,
                async (database) => {
                  await authorize(database);
                  await classPreparationGrant(database, operation).complete(operation.grant);
                  await database.courseClass.update({
                    where: { id: classId },
                    data: { status: 'AVAILABLE', adaptiveSeed },
                  });
                  await database.course.update({
                    where: { id: courseId },
                    data: { activeClassId: classId },
                  });
                  await classPreparationStore(database, courseId).transact((current) => {
                    if (!current || current.id !== operationId)
                      throw new PreparationConflictError();
                    Object.assign(current, {
                      status: 'COMPLETED',
                      result: 'created',
                      updatedAt: Date.now(),
                    });
                  });
                  await sottoJobOutbox(database).complete(operationId, work.fingerprint);
                },
                { signal }
              ),
          }
        );
        if (result.kind !== 'created') {
          await sottoTransaction(prisma, async (database) => {
            await authorize(database);
            await classPreparationGrant(database, operation).complete(operation.grant);
            await classPreparationStore(database, courseId).transact((current) => {
              if (!current || current.id !== operationId) throw new PreparationConflictError();
              Object.assign(current, {
                status: 'COMPLETED',
                result: result.kind,
                classId: result.kind === 'gated' ? result.activeClassId : null,
                updatedAt: Date.now(),
              });
            });
            await sottoJobOutbox(database).complete(operationId, work.fingerprint);
          });
        }
      } catch (error) {
        const uncertain =
          outcomeUnknown || isDurableQueueCleanupFailure(error) || workerSignal?.aborted;
        if (isDurableQueueCleanupFailure(error)) markCleanupUnconfirmed();
        await sottoTransaction(prisma, (database) =>
          recordClassPreparationFailure(
            database,
            operation,
            work.fingerprint,
            Boolean(uncertain),
            error instanceof ClassSourceError ? 'source_unreadable' : 'generation_failed'
          )
        );
        if (uncertain) throw error;
      } finally {
        clearInterval(timer);
        controller.abort();
      }
    },
  });
}
