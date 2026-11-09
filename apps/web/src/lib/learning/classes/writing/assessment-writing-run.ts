import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { learningPreparationProviderRequest } from '@/lib/learning/preparation/preparation-provider';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  readSottoWorkerJob,
  sottoJobOutbox,
  sottoJobSnapshot,
} from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  assessmentWritingBindingSchema,
  writingExecutionSchema,
} from '@/lib/learning/writing/writing-execution';
import {
  runSottoExecutionOperation,
  sottoJobExecutions,
  verifySottoExecutionOperation,
  withSottoJobExecution,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { isDurableQueueCleanupFailure } from '@/lib/sidedoor/jobs/core/durable-queue';
import { gradeWriting, WritingGradeRejected } from '@/lib/writing-grader';
import { objectiveEvidenceHash } from '@/lib/learning-map/evidence/protocol';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { admitAssessmentWriting } from './assessment-writing-admission';
import { captureAssessmentWritingTask } from './assessment-writing-read';
import { settleCompletedAssessmentWriting } from './assessment-writing-recovery';
import {
  assessmentWritingGradeDigest,
  assessmentWritingReceiptSchema,
} from './assessment-writing-receipt';
import {
  assessmentWritingInputDigest,
  assessmentWritingRequestDigest,
} from './assessment-writing-identity';

/** Execute only a newly admitted held-out writing operation. Feedback remains private. */
export async function runAssessmentWriting(input: {
  admission: Awaited<ReturnType<typeof admitAssessmentWriting>>;
  text: string;
  execution: SottoProviderExecution;
}) {
  if (input.admission.replayed) throw new AssessmentFenceConflict();
  const record = await sottoTransaction(prismaUnfiltered, (database) =>
    sottoJobOutbox(database).read(input.admission.operation.id)
  );
  if (
    !record ||
    record.fingerprint !== input.admission.operation.fingerprint ||
    record.job.handler !== 'learning-writing' ||
    record.job.version !== 2
  )
    throw new AssessmentFenceConflict();
  return executeAssessmentWriting(input);
}

async function executeAssessmentWriting(input: {
  admission: Awaited<ReturnType<typeof admitAssessmentWriting>>;
  text: string;
  execution: SottoProviderExecution;
}) {
  const { admission, text, execution } = input;
  const { operation, captured, responseId } = admission;
  if (!operation.assessment || operation.status !== 'RUNNING') throw new AssessmentFenceConflict();
  if (['codex', 'claude-code'].includes(operation.selection.provider))
    throw new Error('This assessment writing provider does not support durable execution.');
  const identity = { parentId: operation.id, fingerprint: operation.fingerprint };
  const signal = execution.signal ?? new AbortController().signal;
  const ownership = await sottoTransaction(prismaUnfiltered, (database) =>
    capturePrerequisiteOwnership(database, captured.classId, captured.courseId, captured.userId)
  );
  const scope = ownership.scopes.find((entry) => entry.subjectId === `class:${captured.classId}`);
  if (!scope) throw new AssessmentFenceConflict();
  let started = false;
  let unknown = false;
  let produced = false;
  let validationFailed = false;
  const launchId = randomUUID();
  const validate = async (database: Prisma.TransactionClient) => {
    try {
      const saved = await admitAssessmentWriting(database, {
        classId: captured.classId,
        assessmentId: captured.assessmentId,
        promptId: captured.prompt.id,
        text,
        execution,
        selection: operation.selection,
        expected: captured,
      });
      if (
        !saved.replayed ||
        saved.responseId !== responseId ||
        !isDeepStrictEqual(saved.operation, operation)
      )
        throw new AssessmentFenceConflict();
      const record = await sottoJobOutbox(database).read(operation.id);
      const grant = await learningPreparationGrant(database, operation, 'writing').read(
        operation.grant
      );
      if (
        !record ||
        record.complete ||
        grant.status !== 'active' ||
        grant.grant.expiresAt <= Date.now()
      )
        throw new AssessmentFenceConflict();
      validationFailed = false;
    } catch (error) {
      validationFailed = true;
      throw error;
    }
  };
  try {
    const result = await withSottoJobExecution({
      database: prismaUnfiltered,
      parentId: operation.id,
      fingerprint: operation.fingerprint,
      capabilityScope: scope,
      signal,
      isCleanupFailure: (error) => unknown || isDurableQueueCleanupFailure(error),
      validate: async (database) => {
        await validate(database);
        const id = `${SIDEDOOR_STATE_ID}:assessment-writing-launch:${operation.id}`;
        const claim = { operationId: operation.id, fingerprint: operation.fingerprint, launchId };
        const prior = await database.sidedoorState.findUnique({ where: { id } });
        if (prior && !isDeepStrictEqual(prior.state, claim)) throw new AssessmentFenceConflict();
        if (!prior)
          await database.sidedoorState.create({
            data: { id, revision: randomUUID(), state: claim },
          });
        const touched =
          await database.$executeRaw`UPDATE "CourseClass" SET "updatedAt" = "updatedAt" WHERE id = ${captured.classId}`;
        if (touched !== 1) throw new AssessmentFenceConflict();
        return true;
      },
      run: async ({ capability, directory, markCleanupUnconfirmed }) => {
        if (!capability) throw new AssessmentFenceConflict();
        started = true;
        return runSottoExecutionOperation(capability, identity, async (effect, effectSignal) => {
          const verify = async (database: Prisma.TransactionClient) => {
            await validate(database);
            await verifySottoExecutionOperation(database, effect, identity);
          };
          const providerRequest = learningPreparationProviderRequest(
            {
              selection: operation.selection,
              admit: async (database, attempt) => {
                await verify(database);
                return learningPreparationGrant(database, operation, 'writing').admit(
                  operation.grant,
                  attempt
                );
              },
              settle: async (database, attempt, outcome) => {
                await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${captured.classId} FOR UPDATE`;
                await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${captured.assessmentId} FOR UPDATE`;
                await verifySottoExecutionOperation(database, effect, identity);
                return learningPreparationGrant(database, operation, 'writing').settle(
                  operation.grant,
                  attempt,
                  outcome
                );
              },
            },
            effectSignal,
            () => {
              unknown = true;
              markCleanupUnconfirmed();
            }
          );
          const grade = await gradeWriting({
            userId: captured.userId,
            execution: {
              ...execution,
              signal: effectSignal,
              learningSelection: operation.selection,
              isolatedWorkspace: { directory, markCleanupUnconfirmed },
              onCleanupError: markCleanupUnconfirmed,
              providerRequest,
            },
            nativeLang: captured.requirements.nativeLang,
            targetLang: captured.requirements.targetLang,
            level: captured.requirements.level,
            task: captured.prompt.task,
            guidance: captured.prompt.privateGuidance,
            ideas: captured.prompt.privateIdeas,
            learningObjectives: captured.prompt.privateLearningObjectives,
            text,
            assessment: { kind: 'HELD_OUT', rubric: captured.prompt.privateRubric },
          });
          produced = true;
          await sottoTransaction(
            prismaUnfiltered,
            async (database) => {
              await verify(database);
              const requestDigest = assessmentWritingRequestDigest(captured, text);
              if (
                assessmentWritingInputDigest(captured, text, operation.selection, requestDigest) !==
                operation.assessment!.inputDigest
              )
                throw new AssessmentFenceConflict();
              const receipt = assessmentWritingReceiptSchema.parse({
                version: 1,
                operationId: operation.id,
                fingerprint: operation.fingerprint,
                assessmentId: captured.assessmentId,
                classId: captured.classId,
                courseId: captured.courseId,
                userId: captured.userId,
                classAttempt: captured.classAttempt,
                assessmentAttempt: captured.assessmentAttempt,
                sectionId: captured.sectionId,
                promptId: captured.prompt.id,
                responseId,
                materialDigest: operation.assessment!.materialDigest,
                inputDigest: operation.assessment!.inputDigest,
                requestDigest,
                textDigest: objectiveEvidenceHash({ text }),
                score: grade.overallScore,
                gradeDigest: assessmentWritingGradeDigest(grade),
              });
              const snapshot = sottoJobSnapshot(database);
              await snapshot.createForJob({ id: operation.id, fingerprint: operation.fingerprint });
              await snapshot.append(operation.id, operation.fingerprint, 0, [receipt]);
              await snapshot.seal(operation.id, operation.fingerprint);
              await database.writingResponse.update({
                where: { id: responseId },
                data: {
                  overallScore: grade.overallScore,
                  corrections: grade.corrections as unknown as Prisma.InputJsonValue,
                  feedback: grade.feedback,
                  objectiveEvidence: grade.objectiveEvidence as unknown as
                    Prisma.InputJsonValue | undefined,
                  gradingState: { ...operation, status: 'COMPLETED' },
                },
              });
              await learningPreparationGrant(database, operation, 'writing').complete(
                operation.grant
              );
              await verifySottoExecutionOperation(database, effect, identity);
            },
            { signal: effectSignal }
          );
          return true;
        });
      },
    });
    if (!result) throw new AssessmentFenceConflict();
    await sottoTransaction(prismaUnfiltered, (database) =>
      sottoJobOutbox(database).complete(operation.id, operation.fingerprint)
    );
  } catch (error) {
    if (!started) throw error;
    await sottoTransaction(prismaUnfiltered, async (database) => {
      await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${captured.classId} FOR UPDATE`;
      await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${captured.assessmentId} FOR UPDATE`;
      const response = await database.writingResponse.findUnique({ where: { id: responseId } });
      if (!response || response.overallScore !== null) return;
      if (!isDeepStrictEqual(response.gradingState, operation)) throw new AssessmentFenceConflict();
      const blocked = await sottoJobExecutions(database).blockingStatus(
        operation.id,
        operation.fingerprint
      );
      if (blocked === 'active') return;
      const activity = await learningPreparationGrant(database, operation, 'writing').revoke(
        operation.grant
      );
      const paidWorkUnsettled =
        (validationFailed || produced || !(error instanceof WritingGradeRejected)) &&
        activity.attempts.some((attempt) =>
          ['admitted', 'unknown', 'succeeded'].includes(attempt.outcome)
        );
      const status = unknown || blocked || paidWorkUnsettled ? 'UNRESOLVED' : 'FAILED';
      await database.writingResponse.update({
        where: { id: responseId },
        data: { gradingState: { ...operation, status } },
      });
      if (!blocked) await sottoJobOutbox(database).complete(operation.id, operation.fingerprint);
    });
    throw error;
  }
}

const queuedWritingSchema = z
  .object({
    responseId: z.string().min(1),
    text: z.string().min(1).max(100_000),
    promptId: z.string().min(1),
    attempt: z.number().int().positive(),
    selection: writingExecutionSchema.shape.selection,
    assessment: assessmentWritingBindingSchema,
  })
  .strict();

/** Reconcile a failed delivery only from a completed, drained retained receipt. */
export async function settleQueuedAssessmentWritingReceipt(
  database: Prisma.TransactionClient,
  identity: { operationId: string; fingerprint: string },
  signal?: AbortSignal
) {
  const record = await sottoJobOutbox(database).read(identity.operationId);
  if (
    !record ||
    record.fingerprint !== identity.fingerprint ||
    record.job.handler !== 'learning-writing' ||
    record.job.version !== 3
  )
    throw new AssessmentFenceConflict();
  if (record.complete) return true;
  const payload = queuedWritingSchema.parse(record.job.payload);
  const response = await database.writingResponse.findUnique({
    where: { id: payload.responseId },
  });
  if (!response || response.text !== payload.text || response.promptId !== payload.promptId)
    throw new AssessmentFenceConflict();
  const operation = writingExecutionSchema.parse(response.gradingState);
  if (
    operation.id !== identity.operationId ||
    operation.fingerprint !== identity.fingerprint ||
    !isDeepStrictEqual(operation.assessment, payload.assessment) ||
    !isDeepStrictEqual(operation.selection, payload.selection) ||
    response.attempt !== payload.attempt
  )
    throw new AssessmentFenceConflict();
  if (operation.status !== 'COMPLETED') return false;
  const execution: SottoProviderExecution = {
    userId: operation.userId,
    signal,
    authorize: async (tx) => {
      const ownership = await capturePrerequisiteOwnership(
        tx,
        payload.assessment.classId,
        operation.courseId,
        operation.userId
      );
      if (
        ownership.instanceId !== operation.instanceId ||
        !isDeepStrictEqual(ownership.scopes, record.job.scopes)
      )
        throw new AssessmentFenceConflict();
      return { userId: operation.userId };
    },
  };
  const recovered = await settleCompletedAssessmentWriting(database, {
    classId: payload.assessment.classId,
    assessmentId: payload.assessment.assessmentId,
    promptId: payload.promptId,
    execution,
  });
  return Boolean(
    recovered &&
    recovered.status === 'COMPLETED' &&
    recovered.operationId === operation.id &&
    recovered.responseId === payload.responseId
  );
}

/** Load and authorize the exact queued operation before claiming its one-shot execution. */
export async function runQueuedAssessmentWriting(job: Job<unknown>, workerSignal?: AbortSignal) {
  const signal = AbortSignal.any([
    ...(workerSignal ? [workerSignal] : []),
    AbortSignal.timeout(5 * 60_000),
  ]);
  const work = await sottoTransaction(
    prismaUnfiltered,
    (database) =>
      readSottoWorkerJob(database, job, {
        handler: 'learning-writing',
        version: 3,
        payload: queuedWritingSchema,
      }),
    { signal }
  );
  if (work.complete) return;
  const { payload } = work;
  try {
    const prepared = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        const response = await database.writingResponse.findUnique({
          where: { id: payload.responseId },
        });
        if (!response || response.text !== payload.text || response.promptId !== payload.promptId)
          throw new AssessmentFenceConflict();
        const operation = writingExecutionSchema.parse(response.gradingState);
        if (
          operation.id !== work.operationId ||
          operation.fingerprint !== work.fingerprint ||
          !isDeepStrictEqual(operation.assessment, payload.assessment) ||
          !isDeepStrictEqual(operation.selection, payload.selection) ||
          response.attempt !== payload.attempt
        )
          throw new AssessmentFenceConflict();
        const execution: SottoProviderExecution = {
          userId: operation.userId,
          signal,
          learningSelection: operation.selection,
          authorize: async (tx) => {
            const ownership = await capturePrerequisiteOwnership(
              tx,
              payload.assessment.classId,
              operation.courseId,
              operation.userId
            );
            if (
              ownership.instanceId !== operation.instanceId ||
              !isDeepStrictEqual(ownership.scopes, work.scopes)
            )
              throw new AssessmentFenceConflict();
            return { userId: operation.userId };
          },
        };
        const input = {
          classId: payload.assessment.classId,
          assessmentId: payload.assessment.assessmentId,
          promptId: payload.promptId,
          execution,
        };
        if (operation.status === 'COMPLETED') {
          const recovered = await settleCompletedAssessmentWriting(database, input);
          if (
            !recovered ||
            recovered.status !== 'COMPLETED' ||
            recovered.operationId !== operation.id ||
            recovered.responseId !== payload.responseId
          )
            throw new AssessmentFenceConflict();
          return { complete: true as const };
        }
        if (operation.status !== 'RUNNING') throw new AssessmentFenceConflict();
        const expected = await captureAssessmentWritingTask(database, input);
        const admission = await admitAssessmentWriting(database, {
          ...input,
          text: payload.text,
          selection: payload.selection,
          expected,
        });
        if (
          !admission.replayed ||
          admission.responseId !== payload.responseId ||
          !isDeepStrictEqual(admission.operation, operation)
        )
          throw new AssessmentFenceConflict();
        return { complete: false as const, admission, execution };
      },
      { signal }
    );
    if (!prepared.complete)
      await executeAssessmentWriting({
        admission: prepared.admission,
        execution: prepared.execution,
        text: payload.text,
      });
  } catch (error) {
    try {
      await sottoTransaction(
        prismaUnfiltered,
        async (database) => {
          await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${payload.assessment.classId} FOR UPDATE`;
          await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${payload.assessment.assessmentId} FOR UPDATE`;
          const record = await sottoJobOutbox(database).read(work.operationId);
          if (
            !record ||
            record.fingerprint !== work.fingerprint ||
            record.job.handler !== 'learning-writing' ||
            record.job.version !== 3 ||
            !isDeepStrictEqual(record.job.payload, payload) ||
            !isDeepStrictEqual(record.job.scopes, work.scopes)
          )
            throw new AssessmentFenceConflict();
          if (record.complete) return;
          await database.$queryRaw`SELECT id FROM "WritingResponse" WHERE id = ${payload.responseId} FOR UPDATE`;
          const response = await database.writingResponse.findUnique({
            where: { id: payload.responseId },
          });
          if (!response) throw new AssessmentFenceConflict();
          const operation = writingExecutionSchema.parse(response.gradingState);
          if (
            operation.id !== work.operationId ||
            operation.fingerprint !== work.fingerprint ||
            !isDeepStrictEqual(operation.assessment, payload.assessment) ||
            !isDeepStrictEqual(operation.selection, payload.selection) ||
            response.text !== payload.text ||
            response.promptId !== payload.promptId
          )
            throw new AssessmentFenceConflict();
          if (operation.status !== 'RUNNING') return;
          const blocked = await sottoJobExecutions(database).blockingStatus(
            operation.id,
            operation.fingerprint
          );
          if (blocked === 'active') return;
          await database.$executeRaw`UPDATE "CourseClass" SET "updatedAt" = "updatedAt" WHERE id = ${payload.assessment.classId}`;
          await database.writingResponse.update({
            where: { id: response.id },
            data: { gradingState: { ...operation, status: 'UNRESOLVED' } },
          });
        },
        { signal: AbortSignal.timeout(30_000) }
      );
    } catch (settlementError) {
      throw new AggregateError(
        [error, settlementError],
        'Queued writing failure could not be retained'
      );
    }
    throw error;
  }
}
