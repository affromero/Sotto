import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { delegationGrantBinding } from 'thesidedoor-core/runtime/delegation';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '../../prisma';
import { preparationSchema } from '../../classes/preparation-state';
import { learningPreparationGrant } from '../preparation/preparation-grant';
import { learningPreparationProviderRequest } from '../preparation/preparation-provider';
import { captureCourseStorage } from '../../sidedoor/storage/core/course-storage';
import { SIDEDOOR_STATE_ID } from '../../sidedoor/access/state/store';
import { sottoTransaction } from '../../sidedoor/access/state/transaction';
import { sottoJobOutbox } from '../../sidedoor/jobs/core/job-delivery';
import {
  sottoJobExecutions,
  withSottoJobExecution,
} from '../../sidedoor/jobs/core/job-execution-lifetime';
import { isDurableQueueCleanupFailure } from '../../sidedoor/jobs/core/durable-queue';
import type { SottoProviderExecution } from '../../sidedoor/credentials/runtime/provider-execution';
import type { WritingGrade } from '../../writing-grader';

export const writingExecutionSchema = z.object({
  status: z.enum(['RUNNING', 'FAILED', 'UNRESOLVED', 'COMPLETED']),
  id: z.uuid(),
  fingerprint: z.string().length(64),
  courseId: z.string(),
  userId: z.string(),
  instanceId: z.uuid(),
  courseCreatedAt: z.number(),
  userCreatedAt: z.number(),
  expiresAt: z.number(),
  grant: z.object({ id: z.uuid(), revision: z.uuid(), fingerprint: z.string().length(64) }),
  selection: preparationSchema.shape.selection,
});

/** Confirmed failures may be replaced only after the original executor has drained. */
export async function writingFailureDrained(database: Prisma.TransactionClient, value: unknown) {
  const state = writingExecutionSchema.safeParse(value);
  if (!state.success || state.data.status !== 'FAILED') return false;
  await sottoJobExecutions(database).requireParentDrained(state.data.id, state.data.fingerprint);
  return true;
}

export type WritingExecution = z.infer<typeof writingExecutionSchema>;

/** The response, grant and execution intent commit together under the learning parent lock. */
export async function admitWritingExecution(
  database: Prisma.TransactionClient,
  input: {
    responseId: string;
    courseId: string;
    execution: SottoProviderExecution;
    selection: WritingExecution['selection'];
  }
): Promise<WritingExecution> {
  const { responseId, courseId, execution, selection } = input;
  const ownership = await captureCourseStorage(database, courseId);
  const profile = ownership.scopes.find(
    (scope) => scope.subjectId === `profile:${execution.userId}`
  );
  const course = ownership.scopes.find((scope) => scope.subjectId === `course:${courseId}`);
  if (!profile || !course || ownership.userId !== execution.userId)
    throw new Error('Writing ownership changed.');
  const response = await database.writingResponse.findUniqueOrThrow({ where: { id: responseId } });
  const id = randomUUID();
  const grantSpec = {
    id,
    revision: randomUUID(),
    instanceId: ownership.instanceId,
    subject: { id: profile.subjectId, generation: profile.generation },
    resource: { id: course.subjectId, generation: course.generation },
    operationId: id,
    action: 'writing-parent-provider-request',
    expiresAt: Date.now() + 5 * 60_000,
    maxRequests: 256,
  };
  const grant = delegationGrantBinding(grantSpec);
  const record = await sottoJobOutbox(database).enqueue(
    prepareJob({
      id,
      namespace: SIDEDOOR_STATE_ID,
      handler: 'learning-writing',
      version: 1,
      payload: {
        responseId,
        text: response.text,
        promptId: response.promptId,
        attempt: response.attempt,
        selection,
      },
      scopes: ownership.scopes,
      delivery: { attempts: 1, priority: 0, availableAt: Date.now() },
    })
  );
  const current: WritingExecution = {
    status: 'RUNNING',
    id,
    fingerprint: record.fingerprint,
    grant,
    courseId,
    userId: execution.userId,
    instanceId: ownership.instanceId,
    userCreatedAt: profile.generation,
    courseCreatedAt: course.generation,
    expiresAt: grantSpec.expiresAt,
    selection,
  };
  await learningPreparationGrant(database, current, 'writing').create(grantSpec);
  await database.writingResponse.update({
    where: { id: responseId },
    data: { gradingState: current },
  });
  return current;
}

/** Reconciliation fences abandoned intent and never replays a provider request. */
export async function reconcileWritingResponse(
  database: Prisma.TransactionClient,
  responseId: string,
  expected?: { id: string; fingerprint: string }
) {
  const first = await database.writingResponse.findUnique({
    where: { id: responseId },
    include: { prompt: { include: { section: true } } },
  });
  if (!first) return;
  if (first.prompt.section)
    await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${first.prompt.section.classId} FOR UPDATE`;
  else if (first.practiceSessionId)
    await database.$queryRaw`SELECT id FROM "PracticeSession" WHERE id = ${first.practiceSessionId} FOR UPDATE`;
  const response = await database.writingResponse.findUniqueOrThrow({ where: { id: responseId } });
  const parsed = writingExecutionSchema.safeParse(response.gradingState);
  if (!parsed.success) return;
  const operation = parsed.data;
  if (expected && (expected.id !== operation.id || expected.fingerprint !== operation.fingerprint))
    throw new Error('Synchronous writing receipt changed.');
  const blocker = await sottoJobExecutions(database).blockingStatus(
    operation.id,
    operation.fingerprint
  );
  if (blocker === 'active') return;
  if (operation.status === 'COMPLETED') {
    if (!blocker) await sottoJobOutbox(database).complete(operation.id, operation.fingerprint);
    return;
  }
  if (operation.status === 'FAILED' && !blocker) {
    await sottoJobOutbox(database).complete(operation.id, operation.fingerprint);
    return;
  }
  if (operation.status !== 'RUNNING' || (!blocker && Date.now() <= operation.expiresAt)) return;
  const grant = learningPreparationGrant(database, operation, 'writing');
  const activity = await grant.revoke(operation.grant);
  const uncertain = Boolean(
    blocker ||
    activity.attempts.some(
      (attempt) =>
        attempt.outcome === 'admitted' ||
        attempt.outcome === 'unknown' ||
        attempt.outcome === 'succeeded'
    )
  );
  const status = uncertain ? 'UNRESOLVED' : 'FAILED';
  if (!blocker)
    await sottoJobExecutions(database).requireParentDrained(operation.id, operation.fingerprint);
  await database.writingResponse.update({
    where: { id: responseId },
    data: { gradingState: { ...operation, status } },
  });
  if (!blocker) await sottoJobOutbox(database).complete(operation.id, operation.fingerprint);
}

/** Keep synchronous grading inside the canonical execution, grant and HTTP journals. */
export async function runWritingExecution(options: {
  responseId: string;
  operation: WritingExecution;
  execution: SottoProviderExecution;
  validate: (database: Prisma.TransactionClient) => Promise<void>;
  grade: (execution: SottoProviderExecution) => Promise<WritingGrade>;
  publish: (database: Prisma.TransactionClient, grade: WritingGrade) => Promise<void>;
}): Promise<WritingGrade> {
  const { responseId, operation: captured, execution } = options;
  const signal = execution.signal ?? new AbortController().signal;
  let unknown = false;
  try {
    const validate = async (database: Prisma.TransactionClient) => {
      await execution.authorize(database);
      await options.validate(database);
      const response = await database.writingResponse.findUniqueOrThrow({
        where: { id: responseId },
      });
      const state = writingExecutionSchema.parse(response.gradingState);
      if (
        state.id !== captured.id ||
        state.status !== 'RUNNING' ||
        state.fingerprint !== captured.fingerprint
      )
        throw new Error('The writing execution changed.');
    };
    const result = await withSottoJobExecution({
      database: prisma,
      parentId: captured.id,
      fingerprint: captured.fingerprint,
      signal,
      isCleanupFailure: (error) => unknown || isDurableQueueCleanupFailure(error),
      validate: async (database) => {
        await validate(database);
        return true;
      },
      run: async ({ directory, markCleanupUnconfirmed }) => {
        const grade = await options.grade({
          ...execution,
          learningSelection: captured.selection,
          isolatedWorkspace: { directory, markCleanupUnconfirmed },
          onCleanupError: markCleanupUnconfirmed,
          providerRequest: learningPreparationProviderRequest(
            {
              selection: captured.selection,
              admit: async (database, attempt) => {
                await validate(database);
                return learningPreparationGrant(database, captured, 'writing').admit(
                  captured.grant,
                  attempt
                );
              },
              settle: async (database, attempt, outcome) =>
                learningPreparationGrant(database, captured, 'writing').settle(
                  captured.grant,
                  attempt,
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
            await options.publish(database, grade);
            await learningPreparationGrant(database, captured, 'writing').complete(captured.grant);
            await database.writingResponse.update({
              where: { id: responseId },
              data: { gradingState: { ...captured, status: 'COMPLETED' } },
            });
          },
          { signal }
        );
        return grade;
      },
    });
    if (!result) throw new Error('Writing execution did not complete.');
    await sottoTransaction(prisma, (database) =>
      sottoJobOutbox(database).complete(captured.id, captured.fingerprint)
    );
    return result;
  } catch (failure) {
    await sottoTransaction(prisma, async (database) => {
      const response = await database.writingResponse.findUnique({ where: { id: responseId } });
      if (!response || response.overallScore !== null) return;
      const blocked = await sottoJobExecutions(database).blockingStatus(
        captured.id,
        captured.fingerprint
      );
      const status = unknown || blocked ? 'UNRESOLVED' : 'FAILED';
      await learningPreparationGrant(database, captured, 'writing').revoke(captured.grant);
      await database.writingResponse.update({
        where: { id: responseId },
        data: { gradingState: { ...captured, status } },
      });
      if (!blocked) await sottoJobOutbox(database).complete(captured.id, captured.fingerprint);
    });
    throw failure;
  }
}
