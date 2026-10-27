import type { Job } from 'bullmq';
import { createHash } from 'node:crypto';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { readSottoWorkerJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  withSottoJobExecution,
  sottoJobExecutions,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { isDurableQueueCleanupFailure } from '@/lib/sidedoor/jobs/core/durable-queue';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { learningPreparationProviderRequest } from '@/lib/learning/preparation/preparation-provider';
import { generateLessonHelp } from '@/lib/classes/help/generate-help';
import { requireLessonHelpSource } from '@/lib/classes/help/lesson-source';
import {
  lessonHelpWorkSchema,
  readLessonHelpOutcome,
  retainLessonHelpOutcome,
} from '@/lib/classes/help/lesson-work';

export async function processClassLessonHelp(
  job: Job<unknown>,
  signal = AbortSignal.timeout(600_000)
) {
  const contract = { handler: 'interactions', version: 2, payload: lessonHelpWorkSchema };
  const work = await sottoTransaction(
    prisma,
    async (database) => {
      const durable = await readSottoWorkerJob(database, job, contract);
      if (!durable.complete)
        await requireLessonHelpSource(database, durable.payload.context, durable.scopes);
      return durable;
    },
    { signal }
  );
  if (work.complete) return;
  const context = work.payload.context;
  const recovered = await sottoTransaction(prisma, async (database) => {
    await requireLessonHelpSource(database, context, work.scopes);
    const outcome = await readLessonHelpOutcome(database, work.operationId, work.fingerprint);
    if (!outcome) return false;
    await sottoJobExecutions(database).requireParentDrained(work.operationId, work.fingerprint);
    await sottoJobOutbox(database).complete(work.operationId, work.fingerprint);
    return true;
  });
  if (recovered) return;
  const operation = { id: work.operationId, courseId: context.courseId, userId: context.userId };
  const attempt = {
    id: work.operationId,
    fingerprint: createHash('sha256').update(JSON.stringify(work.payload)).digest('hex'),
  };
  let unknown = false;
  let dispatched = false;
  const validate = (database: Parameters<typeof requireLessonHelpSource>[0]) =>
    requireLessonHelpSource(database, context, work.scopes);
  try {
    await withSottoJobExecution({
      database: prisma,
      parentId: work.operationId,
      fingerprint: work.fingerprint,
      signal,
      isCleanupFailure: (error) => unknown || isDurableQueueCleanupFailure(error),
      validate: async (database) => {
        const current = await readSottoWorkerJob(database, job, contract);
        if (current.complete) return false;
        await validate(database);
        if (await readLessonHelpOutcome(database, work.operationId, work.fingerprint))
          throw new Error('The previous lesson-help result is retained and will not be replayed.');
        return true;
      },
      run: async ({ directory, markCleanupUnconfirmed }) => {
        const admitted = await sottoTransaction(
          prisma,
          async (database) => {
            await validate(database);
            return learningPreparationGrant(database, operation, 'lesson-help').admit(
              work.payload.grant,
              attempt
            );
          },
          { signal }
        );
        if (!admitted.dispatch) throw new Error('This lesson-help request was already dispatched.');
        dispatched = true;
        await job.updateProgress(10);
        const help = await generateLessonHelp(context, {
          userId: context.userId,
          signal,
          learningSelection: work.payload.selection,
          isolatedWorkspace: { directory, markCleanupUnconfirmed },
          onCleanupError: markCleanupUnconfirmed,
          authorize: async (database) => {
            await validate(database);
            return { userId: context.userId };
          },
          providerRequest: learningPreparationProviderRequest(
            {
              selection: work.payload.selection,
              admit: async (database, request) => {
                await validate(database);
                return learningPreparationGrant(database, operation, 'lesson-help').admit(
                  work.payload.grant,
                  request
                );
              },
              settle: (database, request, outcome) =>
                learningPreparationGrant(database, operation, 'lesson-help').settle(
                  work.payload.grant,
                  request,
                  outcome
                ),
            },
            signal,
            () => {
              unknown = true;
              markCleanupUnconfirmed();
            }
          ),
        });
        await sottoTransaction(
          prisma,
          async (database) => {
            await validate(database);
            const grant = learningPreparationGrant(database, operation, 'lesson-help');
            await grant.settle(work.payload.grant, attempt, 'succeeded');
            await grant.complete(work.payload.grant);
            await retainLessonHelpOutcome(database, work.operationId, work.fingerprint, {
              status: 'READY',
              help,
            });
          },
          { signal }
        );
        dispatched = false;
      },
    });
    await sottoTransaction(prisma, async (database) => {
      await validate(database);
      await sottoJobExecutions(database).requireParentDrained(work.operationId, work.fingerprint);
      await sottoJobOutbox(database).complete(work.operationId, work.fingerprint);
    });
    await job.updateProgress(100);
  } catch (failure) {
    await sottoTransaction(prisma, async (database) => {
      await validate(database);
      const record = await sottoJobOutbox(database).read(work.operationId);
      if (record?.complete) return;
      const grant = learningPreparationGrant(database, operation, 'lesson-help');
      const retained = await readLessonHelpOutcome(database, work.operationId, work.fingerprint);
      const blocked = await sottoJobExecutions(database).blockingStatus(
        work.operationId,
        work.fingerprint
      );
      if (!retained) {
        if (dispatched)
          await grant.settle(
            work.payload.grant,
            attempt,
            unknown || blocked ? 'unknown' : 'failed'
          );
        await grant.revoke(work.payload.grant);
      }
      if (!retained)
        await retainLessonHelpOutcome(database, work.operationId, work.fingerprint, {
          status: 'FAILED',
          uncertain: unknown || Boolean(blocked),
          error:
            unknown || blocked
              ? 'The language-help request has an unconfirmed outcome. Check the server before trying again.'
              : 'Native-language help could not be prepared. You can retry after the request has finished.',
        });
      if (!blocked && !unknown)
        await sottoJobOutbox(database).complete(work.operationId, work.fingerprint);
    });
    throw failure;
  }
}
