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
import { requireVocabularyExamplesSource } from '@/lib/vocabulary/examples/source';
import { generateVocabularyExamples } from '@/lib/vocabulary/examples/generate';
import {
  vocabularyExamplesWorkSchema,
  readVocabularyExamplesOutcome,
  retainVocabularyExamples,
} from '@/lib/vocabulary/examples/work';

export async function processVocabularyExamples(
  job: Job<unknown>,
  signal = AbortSignal.timeout(600_000)
) {
  try {
    await runVocabularyExamples(job, signal);
  } catch {
    throw new Error('Vocabulary examples could not be prepared.');
  }
}

async function runVocabularyExamples(job: Job<unknown>, signal: AbortSignal) {
  const contract = { handler: 'interactions', version: 3, payload: vocabularyExamplesWorkSchema };
  const work = await sottoTransaction(
    prisma,
    async (database) => {
      const durable = await readSottoWorkerJob(database, job, contract);
      if (!durable.complete)
        await requireVocabularyExamplesSource(database, durable.payload.context, durable.scopes);
      return durable;
    },
    { signal }
  );
  if (work.complete) return;
  const context = work.payload.context;
  const validate = (database: Parameters<typeof requireVocabularyExamplesSource>[0]) =>
    requireVocabularyExamplesSource(database, context, work.scopes);
  const recovered = await sottoTransaction(prisma, async (database) => {
    await validate(database);
    const outcome = await readVocabularyExamplesOutcome(
      database,
      work.operationId,
      work.fingerprint
    );
    if (!outcome) return false;
    await sottoJobExecutions(database).requireParentDrained(work.operationId, work.fingerprint);
    const saved = await database.flashcardExample.updateMany({
      where: {
        practiceSessionId: context.sessionId,
        cardId: context.cardId,
        courseId: context.courseId,
        operationId: work.operationId,
        status: { in: ['PENDING', 'PUBLISHING'] },
      },
      data: { status: outcome.status === 'READY' ? 'READY' : 'FAILED' },
    });
    if (saved.count !== 1) throw new Error('The example request changed before recovery.');
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
        if (await readVocabularyExamplesOutcome(database, work.operationId, work.fingerprint))
          throw new Error('The previous example result is retained and will not be replayed.');
        return true;
      },
      run: async ({ directory, markCleanupUnconfirmed }) => {
        const admitted = await sottoTransaction(
          prisma,
          async (database) => {
            const source = await validate(database);
            const admission = await learningPreparationGrant(
              database,
              operation,
              'vocabulary'
            ).admit(work.payload.grant, attempt);
            return { admission, word: source.word };
          },
          { signal }
        );
        if (!admitted.admission.dispatch)
          throw new Error('This example request was already dispatched.');
        dispatched = true;
        await job.updateProgress(10);
        const examples = await generateVocabularyExamples(context, admitted.word, {
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
                return learningPreparationGrant(database, operation, 'vocabulary').admit(
                  work.payload.grant,
                  request
                );
              },
              settle: (database, request, outcome) =>
                learningPreparationGrant(database, operation, 'vocabulary').settle(
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
            const grant = learningPreparationGrant(database, operation, 'vocabulary');
            await grant.settle(work.payload.grant, attempt, 'succeeded');
            await grant.complete(work.payload.grant);
            const saved = await database.flashcardExample.updateMany({
              where: {
                practiceSessionId: context.sessionId,
                cardId: context.cardId,
                courseId: context.courseId,
                sourceHash: context.sourceHash,
                operationId: work.operationId,
                status: 'PENDING',
              },
              data: { status: 'PUBLISHING', examples },
            });
            if (saved.count !== 1)
              throw new Error('The example request changed before publication.');
            await retainVocabularyExamples(database, work.operationId, work.fingerprint, {
              status: 'READY',
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
      const saved = await database.flashcardExample.updateMany({
        where: {
          practiceSessionId: context.sessionId,
          cardId: context.cardId,
          courseId: context.courseId,
          operationId: work.operationId,
          status: 'PUBLISHING',
        },
        data: { status: 'READY' },
      });
      if (saved.count !== 1) throw new Error('The example request changed before completion.');
      await sottoJobOutbox(database).complete(work.operationId, work.fingerprint);
    });
    await job.updateProgress(100);
  } catch {
    await sottoTransaction(prisma, async (database) => {
      await validate(database);
      const record = await sottoJobOutbox(database).read(work.operationId);
      if (record?.complete) return;
      const grant = learningPreparationGrant(database, operation, 'vocabulary');
      const retained = await readVocabularyExamplesOutcome(
        database,
        work.operationId,
        work.fingerprint
      );
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
        await retainVocabularyExamples(database, work.operationId, work.fingerprint, {
          status: 'FAILED',
          uncertain: unknown || Boolean(blocked),
          error:
            unknown || blocked
              ? 'The example request has an unconfirmed outcome. Check the server before retrying.'
              : 'Examples could not be prepared. You can retry after the request has finished.',
        });
        await database.flashcardExample.updateMany({
          where: {
            practiceSessionId: context.sessionId,
            cardId: context.cardId,
            courseId: context.courseId,
            operationId: work.operationId,
            status: 'PENDING',
          },
          data: { status: unknown || blocked ? 'UNRESOLVED' : 'FAILED' },
        });
      }
      if (retained?.status === 'READY' && !blocked && !unknown) {
        const saved = await database.flashcardExample.updateMany({
          where: {
            practiceSessionId: context.sessionId,
            cardId: context.cardId,
            courseId: context.courseId,
            operationId: work.operationId,
            status: 'PUBLISHING',
          },
          data: { status: 'READY' },
        });
        if (saved.count !== 1) throw new Error('The example request changed before completion.');
      }
      if (!blocked && !unknown)
        await sottoJobOutbox(database).complete(work.operationId, work.fingerprint);
    });
    throw new Error('Vocabulary examples could not be prepared.');
  }
}
