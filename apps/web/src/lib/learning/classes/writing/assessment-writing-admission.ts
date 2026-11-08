import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  admitWritingExecution,
  writingExecutionSchema,
  type WritingExecution,
} from '@/lib/learning/writing/writing-execution';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { captureAssessmentWritingTask } from './assessment-writing-read';
import {
  assessmentWritingInputDigest,
  assessmentWritingRequestDigest,
} from './assessment-writing-identity';

/** Admit one reviewed writing response and its provider grant in the caller's transaction. */
export async function admitAssessmentWriting(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    assessmentId: string;
    promptId: string;
    text: string;
    execution: SottoProviderExecution;
    selection: WritingExecution['selection'];
    expected: Awaited<ReturnType<typeof captureAssessmentWritingTask>>;
    queued?: boolean;
  }
) {
  const text = z
    .string()
    .max(100_000)
    .refine((value) => value.trim().length > 0)
    .parse(input.text);
  const selection = writingExecutionSchema.shape.selection.parse(input.selection);
  if (['codex', 'claude-code'].includes(selection.provider))
    throw new Error('This assessment writing provider does not support durable execution.');
  input.execution.signal?.throwIfAborted();
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${input.assessmentId} FOR UPDATE`;
  const captured = await captureAssessmentWritingTask(database, input);
  if (!isDeepStrictEqual(captured, input.expected)) throw new AssessmentFenceConflict();
  const requestDigest = assessmentWritingRequestDigest(captured, text);
  const inputDigest = assessmentWritingInputDigest(captured, text, selection, requestDigest);
  const binding = {
    assessmentId: captured.assessmentId,
    classId: captured.classId,
    classAttempt: captured.classAttempt,
    assessmentAttempt: captured.assessmentAttempt,
    sectionId: captured.sectionId,
    materialDigest: captured.materialDigest,
    inputDigest,
  };
  const responses = await database.writingResponse.findMany({
    where: {
      promptId: input.promptId,
      assessmentSectionId: captured.sectionId,
      attempt: captured.assessmentAttempt,
    },
    take: 2,
  });
  if (responses.length > 1) throw new AssessmentFenceConflict();
  const previous = responses[0];
  if (previous) {
    const parsed = writingExecutionSchema.safeParse(previous.gradingState);
    if (
      !parsed.success ||
      previous.userId !== captured.userId ||
      previous.text !== text ||
      previous.sectionId !== null ||
      previous.practiceSessionId !== null ||
      previous.examSectionId !== null
    )
      throw new AssessmentFenceConflict();
    const operation = parsed.data;
    const record = await sottoJobOutbox(database).read(operation.id);
    const ownership = await capturePrerequisiteOwnership(
      database,
      captured.classId,
      captured.courseId,
      captured.userId
    );
    if (
      operation.userId !== captured.userId ||
      operation.courseId !== captured.courseId ||
      operation.instanceId !== ownership.instanceId ||
      operation.grant.id !== operation.id ||
      !ownership.scopes.some(
        (scope) =>
          scope.subjectId === `profile:${captured.userId}` &&
          scope.generation === operation.userCreatedAt
      ) ||
      !ownership.scopes.some(
        (scope) =>
          scope.subjectId === `course:${captured.courseId}` &&
          scope.generation === operation.courseCreatedAt
      ) ||
      !isDeepStrictEqual(operation.assessment, binding) ||
      !isDeepStrictEqual(operation.selection, selection) ||
      !record ||
      record.fingerprint !== operation.fingerprint ||
      record.job.id !== operation.id ||
      record.job.handler !== 'learning-writing' ||
      ![2, 3].includes(record.job.version) ||
      !isDeepStrictEqual(record.job.scopes, ownership.scopes) ||
      !isDeepStrictEqual(record.job.payload, {
        responseId: previous.id,
        text,
        promptId: captured.prompt.id,
        attempt: captured.assessmentAttempt,
        selection,
        assessment: binding,
      })
    )
      throw new AssessmentFenceConflict();
    await learningPreparationGrant(database, operation, 'writing').read(operation.grant);
    return { responseId: previous.id, operation, captured, replayed: true as const };
  }
  const response = await database.writingResponse.create({
    data: {
      promptId: input.promptId,
      assessmentSectionId: captured.sectionId,
      userId: captured.userId,
      attempt: captured.assessmentAttempt,
      text,
    },
  });
  const operation = await admitWritingExecution(database, {
    responseId: response.id,
    courseId: captured.courseId,
    execution: input.execution,
    selection,
    assessment: binding,
    queuedAssessment: input.queued,
  });
  input.execution.signal?.throwIfAborted();
  return { responseId: response.id, operation, captured, replayed: false as const };
}
