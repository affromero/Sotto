import type { Job } from 'bullmq';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { readSottoWorkerJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  withSottoJobExecution,
  sottoJobExecutions,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { isDurableQueueCleanupFailure } from '@/lib/sidedoor/jobs/core/durable-queue';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { learningPreparationProviderRequest } from '@/lib/learning/preparation/preparation-provider';
import { upsertLiveVocab } from '@/lib/knowledge-graph';
import { unseenVocabularyWhere } from '@/lib/learning/vocabulary/memory';
import { requireVocabularyRefillSource } from '@/lib/vocabulary/refill/source';
import { generateVocabularyRefill } from '@/lib/vocabulary/refill/generate';
import {
  vocabularyRefillWorkSchema,
  readVocabularyRefillOutcome,
  retainVocabularyRefill,
} from '@/lib/vocabulary/refill/work';

export async function processVocabularyRefill(
  job: Job<unknown>,
  signal = AbortSignal.timeout(600_000)
) {
  try {
    await runVocabularyRefill(job, signal);
  } catch {
    throw new Error('New vocabulary could not be prepared.');
  }
}

async function runVocabularyRefill(job: Job<unknown>, signal: AbortSignal) {
  const contract = { handler: 'interactions', version: 4, payload: vocabularyRefillWorkSchema };
  const work = await sottoTransaction(
    prisma,
    async (database) => {
      return readSottoWorkerJob(database, job, contract);
    },
    { signal }
  );
  if (work.complete) return;
  const context = work.payload.context;
  const operation = { id: work.operationId, courseId: context.courseId, userId: context.userId };
  const attempt = {
    id: work.operationId,
    fingerprint: createHash('sha256').update(JSON.stringify(work.payload)).digest('hex'),
  };
  const validateIdentity = async (
    database: Parameters<typeof requireVocabularyRefillSource>[0]
  ) => {
    const owner = await captureCourseStorage(database, context.courseId);
    if (owner.userId !== context.userId || !isDeepStrictEqual(owner.scopes, work.scopes))
      throw new Error('The vocabulary refill ownership changed.');
    const row = await database.vocabularyRefill.findUnique({
      where: { courseId: context.courseId },
    });
    if (
      !row ||
      row.operationId !== work.operationId ||
      row.generation !== context.generation ||
      row.sourceHash !== context.sourceHash ||
      !['PENDING', 'PUBLISHING'].includes(row.status)
    )
      throw new Error('The vocabulary refill changed.');
  };
  const validate = async (database: Parameters<typeof requireVocabularyRefillSource>[0]) => {
    await validateIdentity(database);
    await requireVocabularyRefillSource(database, context, work.scopes);
  };
  let unknown = false;
  let dispatched = false;
  try {
    const recover = await sottoTransaction(prisma, async (database) => {
      await validateIdentity(database);
      const outcome = await readVocabularyRefillOutcome(
        database,
        work.operationId,
        work.fingerprint
      );
      if (!outcome) return false;
      if (outcome.status === 'FAILED' && outcome.uncertain)
        throw new Error('The refill outcome needs recovery.');
      await sottoJobExecutions(database).requireParentDrained(work.operationId, work.fingerprint);
      const saved = await database.vocabularyRefill.updateMany({
        where: {
          courseId: context.courseId,
          operationId: work.operationId,
          status: { in: ['PENDING', 'PUBLISHING'] },
        },
        data: { status: outcome.status === 'READY' ? 'READY' : 'FAILED' },
      });
      if (saved.count !== 1) throw new Error('The vocabulary refill changed before recovery.');
      await sottoJobOutbox(database).complete(work.operationId, work.fingerprint);
      return true;
    });
    if (recover) return;
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
        if (await readVocabularyRefillOutcome(database, work.operationId, work.fingerprint))
          throw new Error('The previous refill result is retained and will not be replayed.');
        return true;
      },
      run: async ({ directory, markCleanupUnconfirmed }) => {
        const admitted = await sottoTransaction(
          prisma,
          async (database) => {
            await validate(database);
            const admission = await learningPreparationGrant(
              database,
              operation,
              'vocabulary'
            ).admit(work.payload.grant, attempt);
            const recent = await database.learnerVocab.findMany({
              where: { courseId: context.courseId },
              select: { lemma: true },
              orderBy: { createdAt: 'desc' },
              take: 200,
            });
            return { admission, recent: recent.map((word) => word.lemma) };
          },
          { signal }
        );
        if (!admitted.admission.dispatch) throw new Error('This refill was already dispatched.');
        dispatched = true;
        await job.updateProgress(10);
        const words = await generateVocabularyRefill(context, admitted.recent, {
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
            await database.$queryRaw`SELECT id FROM "Course" WHERE id = ${context.courseId} FOR UPDATE`;
            await validate(database);
            let added = 0;
            if (
              (await database.learnerVocab.count({
                where: { courseId: context.courseId, ...unseenVocabularyWhere() },
              })) === 0
            ) {
              const existing = new Set<string>();
              let after: string | undefined;
              const normalize = (value: string) =>
                value
                  .normalize('NFC')
                  .replace(/\s+/gu, ' ')
                  .trim()
                  .toLocaleLowerCase(context.targetLang);
              do {
                const page = await database.learnerVocab.findMany({
                  where: { courseId: context.courseId },
                  select: { id: true, lemma: true },
                  orderBy: { id: 'asc' },
                  take: 500,
                  ...(after ? { cursor: { id: after }, skip: 1 } : {}),
                });
                for (const item of page) existing.add(normalize(item.lemma));
                after = page.length === 500 ? page[page.length - 1]!.id : undefined;
              } while (after);
              const unique = words.filter((word) => {
                const key = normalize(word.lemma);
                if (!key || existing.has(key)) return false;
                existing.add(key);
                return true;
              });
              if (!unique.length)
                throw new Error('The generated words were already in the dictionary.');
              const level = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).parse(context.level);
              added = await upsertLiveVocab(
                context.courseId,
                unique.map((word) => ({
                  lemma: word.lemma,
                  gloss: word.meaning,
                  pos: word.partOfSpeech ?? undefined,
                })),
                level,
                database
              );
            }
            const nextWords = await database.learnerVocab.findMany({
              where: { courseId: context.courseId, ...unseenVocabularyWhere() },
              select: { id: true },
              orderBy: { createdAt: 'asc' },
              take: 8,
            });
            const wordIds = nextWords.map((word) => word.id);
            if (!wordIds.length) throw new Error('No new words are available for continuation.');
            const grant = learningPreparationGrant(database, operation, 'vocabulary');
            await grant.settle(work.payload.grant, attempt, 'succeeded');
            await grant.complete(work.payload.grant);
            const saved = await database.vocabularyRefill.updateMany({
              where: {
                courseId: context.courseId,
                operationId: work.operationId,
                status: 'PENDING',
              },
              data: { status: 'PUBLISHING', added, wordIds },
            });
            if (saved.count !== 1)
              throw new Error('The vocabulary refill changed before publication.');
            await retainVocabularyRefill(database, work.operationId, work.fingerprint, {
              status: 'READY',
              added,
              wordIds,
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
      const saved = await database.vocabularyRefill.updateMany({
        where: { courseId: context.courseId, operationId: work.operationId, status: 'PUBLISHING' },
        data: { status: 'READY' },
      });
      if (saved.count !== 1) throw new Error('The vocabulary refill changed before completion.');
      await sottoJobOutbox(database).complete(work.operationId, work.fingerprint);
    });
    await job.updateProgress(100);
  } catch {
    await sottoTransaction(prisma, async (database) => {
      const owner = await captureCourseStorage(database, context.courseId);
      if (owner.userId !== context.userId || !isDeepStrictEqual(owner.scopes, work.scopes))
        throw new Error('The vocabulary refill ownership changed.');
      const record = await sottoJobOutbox(database).read(work.operationId);
      if (record?.complete) return;
      const grant = learningPreparationGrant(database, operation, 'vocabulary');
      const retained = await readVocabularyRefillOutcome(
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
        await retainVocabularyRefill(database, work.operationId, work.fingerprint, {
          status: 'FAILED',
          uncertain: unknown || Boolean(blocked),
          error:
            unknown || blocked
              ? 'The refill has an unconfirmed outcome. Check the server before retrying.'
              : 'New words could not be prepared. You can try again.',
        });
        await database.vocabularyRefill.updateMany({
          where: { courseId: context.courseId, operationId: work.operationId, status: 'PENDING' },
          data: { status: unknown || blocked ? 'UNRESOLVED' : 'FAILED' },
        });
      }
      if (retained?.status === 'READY' && !blocked && !unknown) {
        const saved = await database.vocabularyRefill.updateMany({
          where: {
            courseId: context.courseId,
            operationId: work.operationId,
            status: 'PUBLISHING',
          },
          data: { status: 'READY' },
        });
        if (saved.count !== 1) throw new Error('The vocabulary refill changed before completion.');
      }
      if (!blocked && !unknown)
        await sottoJobOutbox(database).complete(work.operationId, work.fingerprint);
    });
    throw new Error('New vocabulary could not be prepared.');
  }
}
