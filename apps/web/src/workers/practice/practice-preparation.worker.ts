import type { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { startPractice } from '@/lib/practice-service';
import { startPreparation, PreparationConflictError } from '@/lib/classes/preparation-state';
import { registerPreparationAudio } from '@/lib/classes/preparation-audio';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { readSottoWorkerJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  withSottoJobExecution,
  sottoJobExecutions,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { isDurableQueueCleanupFailure } from '@/lib/sidedoor/jobs/core/durable-queue';
import { learningPreparationProviderRequest } from '@/lib/learning/preparation/preparation-provider';
import {
  PRACTICE_PREPARATION_QUEUE,
  practicePreparationPayload,
  validatePracticePreparation,
  writePracticePreparation,
  practicePreparationGrant,
  reconcilePracticePreparation,
} from '@/lib/practice/preparation';
import { assertStoredPracticeMaterial } from '@/lib/practice/material';
import { writeLearningFailure } from '@/lib/classes/quality/teaching-failure-store';
import {
  captureGenerationFailure,
  generationCleanupUnconfirmed,
} from '@/lib/classes/quality/generation-failure';

/** A delivery can replay publication, but never interrupted paid generation. */
export async function processPracticePreparation(job: Job<unknown>, workerSignal?: AbortSignal) {
  const work = await sottoTransaction(prisma, (database) =>
    readSottoWorkerJob(database, job, {
      handler: PRACTICE_PREPARATION_QUEUE,
      version: 1,
      payload: practicePreparationPayload,
    })
  );
  if (work.complete) return;
  const { sessionId, operationId } = work.payload;
  if (operationId !== work.operationId)
    throw new PreparationConflictError('Practice preparation identity changed.');
  const existingExecution = await sottoTransaction(prisma, async (database) => {
    const current = await validatePracticePreparation(database, sessionId, operationId, true);
    const blocker = await sottoJobExecutions(database).blockingStatus(
      operationId,
      work.fingerprint
    );
    return { blocker, userId: current.operation.userId };
  });
  if (existingExecution.blocker) {
    await reconcilePracticePreparation(sessionId, existingExecution.userId);
    return;
  }
  const controller = new AbortController();
  const signal = workerSignal
    ? AbortSignal.any([workerSignal, controller.signal])
    : controller.signal;
  let unknownOutcome = false;
  let generationFailure:
    import('@/lib/classes/quality/generation-failure').GenerationFailure | undefined;
  try {
    await withSottoJobExecution({
      database: prisma,
      parentId: operationId,
      fingerprint: work.fingerprint,
      signal,
      isCleanupFailure: (error) =>
        unknownOutcome ||
        isDurableQueueCleanupFailure(error) ||
        generationCleanupUnconfirmed(error),
      validate: async (database) => {
        const current = await readSottoWorkerJob(database, job, {
          handler: PRACTICE_PREPARATION_QUEUE,
          version: 1,
          payload: practicePreparationPayload,
        });
        if (current.complete) return false;
        await validatePracticePreparation(database, sessionId, operationId, true);
        return true;
      },
      run: async ({ directory, markCleanupUnconfirmed }) => {
        const admitted = await sottoTransaction(prisma, async (database) => {
          const current = await validatePracticePreparation(database, sessionId, operationId, true);
          const operation = startPreparation(current.operation, Date.now());
          await writePracticePreparation(database, operation);
          return { ...current, operation };
        });
        const { operation, generation } = admitted;
        if (operation.status !== 'RUNNING') {
          await sottoTransaction(prisma, async (database) => {
            if (['FAILED', 'CANCELLED'].includes(operation.status))
              await writePracticePreparation(database, operation, {
                status: operation.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
              });
            if (operation.status !== 'COMPLETED')
              await practicePreparationGrant(database, operation).revoke(operation.grant);
            if (operation.status !== 'UNRESOLVED')
              await sottoJobOutbox(database).complete(operationId, work.fingerprint);
          });
          return;
        }
        let checking = false;
        const timer = setInterval(() => {
          if (checking || signal.aborted) return;
          checking = true;
          void sottoTransaction(prisma, async (database) => {
            const current = await validatePracticePreparation(database, sessionId, operationId);
            if (Date.now() - current.operation.updatedAt >= 5_000)
              await writePracticePreparation(database, {
                ...current.operation,
                updatedAt: Date.now(),
              });
          })
            .catch((error: unknown) => controller.abort(error))
            .finally(() => {
              checking = false;
            });
        }, 500);
        const authorize = async (database: Parameters<typeof validatePracticePreparation>[0]) => {
          signal.throwIfAborted();
          const current = await validatePracticePreparation(database, sessionId, operationId);
          return { userId: current.operation.userId };
        };
        try {
          const result = await startPractice(
            operation.courseId,
            operation.userId,
            admitted.session.kind,
            {
              userId: operation.userId,
              authorize,
              signal,
              learningSelection: operation.selection,
              isolatedWorkspace: { directory, markCleanupUnconfirmed },
              onCleanupError: () => {
                unknownOutcome = true;
                markCleanupUnconfirmed();
              },
              registerAudioEpisode: (database, episodeId, generationKey) =>
                registerPreparationAudio(database, operation, episodeId, generationKey, 'practice'),
              providerRequest: learningPreparationProviderRequest(
                {
                  selection: operation.selection,
                  admit: async (database, attempt) => {
                    const current = await validatePracticePreparation(
                      database,
                      sessionId,
                      operationId
                    );
                    return practicePreparationGrant(database, current.operation).admit(
                      current.operation.grant,
                      attempt
                    );
                  },
                  settle: async (database, attempt, outcome) => {
                    const current = await validatePracticePreparation(
                      database,
                      sessionId,
                      operationId,
                      true
                    );
                    return practicePreparationGrant(database, current.operation).settle(
                      current.operation.grant,
                      attempt,
                      outcome
                    );
                  },
                },
                signal,
                () => {
                  unknownOutcome = true;
                  markCleanupUnconfirmed();
                  controller.abort(
                    new PreparationConflictError('The provider outcome is unresolved.')
                  );
                }
              ),
            },
            {
              generation,
              lifecycle: {
                onGenerationFailure: (failure) => {
                  generationFailure = failure;
                },
                populate: (data) =>
                  sottoTransaction(
                    prisma,
                    async (database) => {
                      await authorize(database);
                      if (
                        data.courseId !== operation.courseId ||
                        data.kind !== admitted.session.kind
                      )
                        throw new PreparationConflictError(
                          'The generated practice parent changed.'
                        );
                      const { id: generatedId, startedAt, ...content } = data;
                      if (generatedId || startedAt)
                        throw new PreparationConflictError(
                          'Practice generation cannot replace its admitted identity.'
                        );
                      return database.practiceSession.update({
                        where: { id: sessionId },
                        data: {
                          ...content,
                          status: 'GENERATING',
                          skillRequirements: generation.requirements,
                        },
                      });
                    },
                    { signal }
                  ),
              },
            }
          );
          await sottoTransaction(
            prisma,
            async (database) => {
              const current = await validatePracticePreparation(database, sessionId, operationId);
              if (result.status !== 'unavailable')
                await assertStoredPracticeMaterial(database, sessionId);
              await practicePreparationGrant(database, current.operation).complete(
                current.operation.grant
              );
              await writePracticePreparation(
                database,
                {
                  ...current.operation,
                  status: 'COMPLETED',
                  updatedAt: Date.now(),
                  unavailableReason: result.status === 'unavailable' ? result.reason : null,
                },
                { status: result.status === 'unavailable' ? 'FAILED' : 'ACTIVE' }
              );
              await sottoJobOutbox(database).complete(operationId, work.fingerprint);
            },
            { signal }
          );
        } catch (error) {
          const uncertain = Boolean(
            unknownOutcome ||
            isDurableQueueCleanupFailure(error) ||
            generationCleanupUnconfirmed(error) ||
            workerSignal?.aborted
          );
          if (uncertain) markCleanupUnconfirmed();
          await sottoTransaction(prisma, async (database) => {
            const current = await validatePracticePreparation(
              database,
              sessionId,
              operationId,
              true
            );
            if (current.operation.status === 'COMPLETED') return;
            await practicePreparationGrant(database, current.operation).revoke(
              current.operation.grant
            );
            const cancelling = current.operation.status === 'CANCELLING';
            const status =
              uncertain || current.operation.audioEpisodeIds.length
                ? 'UNRESOLVED'
                : cancelling
                  ? 'CANCELLED'
                  : 'FAILED';
            await writePracticePreparation(
              database,
              {
                ...current.operation,
                status,
                failure: uncertain ? 'interrupted' : cancelling ? null : 'generation_failed',
                updatedAt: Date.now(),
              },
              { status: status === 'CANCELLED' ? 'CANCELLED' : 'FAILED' }
            );
            if (
              !cancelling &&
              (status === 'FAILED' || (status === 'UNRESOLVED' && generationFailure))
            )
              await writeLearningFailure(
                database,
                { ...current.operation, status },
                work.fingerprint,
                generationFailure ?? captureGenerationFailure(error)
              );
            if (!uncertain) await sottoJobOutbox(database).complete(operationId, work.fingerprint);
          });
          if (uncertain) throw error;
        } finally {
          clearInterval(timer);
          controller.abort();
        }
      },
    });
  } catch (error) {
    await sottoTransaction(prisma, async (database) => {
      const current = await validatePracticePreparation(database, sessionId, operationId, true);
      if (['COMPLETED', 'CANCELLED', 'FAILED', 'UNRESOLVED'].includes(current.operation.status))
        return;
      await practicePreparationGrant(database, current.operation).revoke(current.operation.grant);
      const blocked = await sottoJobExecutions(database).blockingStatus(
        operationId,
        work.fingerprint
      );
      const status = blocked || current.operation.audioEpisodeIds.length ? 'UNRESOLVED' : 'FAILED';
      await writePracticePreparation(
        database,
        {
          ...current.operation,
          status,
          failure: status === 'UNRESOLVED' ? 'interrupted' : 'generation_failed',
          updatedAt: Date.now(),
        },
        { status: 'FAILED' }
      );
      if (!blocked) await sottoJobOutbox(database).complete(operationId, work.fingerprint);
    });
    throw error;
  }
}
