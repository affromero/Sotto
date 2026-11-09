import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { readInitialA1PracticeAuthorization } from '@/lib/classes/lesson/initial-a1-provenance';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { classSpeakingGradingPayloadSchema } from '@/lib/sidedoor/jobs/stitch/speaking-grading-work';
import { hasSettledSottoExecution } from '@/lib/sidedoor/jobs/core/job-settlement-proof';
import { resolveOwnedClassStorage } from '../lifecycle/assessment-storage-relocation';
import { lockPracticeGrant, readLockedPracticeOutbox } from './assessment-practice-execution';

/** Legacy feedback has no operation binding. New feedback must retain its exact durable work. */
export async function hasFormativeSpeakingReceipt(
  database: Prisma.TransactionClient,
  input: {
    recording: { id: string; createdAt: Date; gradingOperationId: string | null; audioUrl: string };
    prompt: { id: string; createdAt: Date; sectionId: string | null };
    classId: string;
    courseId: string;
    userId: string;
    authorization: Awaited<ReturnType<typeof readInitialA1PracticeAuthorization>>;
  }
) {
  const operationId = input.recording.gradingOperationId;
  if (operationId === null) return true;
  if (!z.uuid().safeParse(operationId).success) return false;
  const record = await readLockedPracticeOutbox(database, operationId);
  if (
    !record ||
    !record.complete ||
    record.job.id !== operationId ||
    record.job.handler !== 'speaking-grading' ||
    record.job.version !== 2
  )
    return false;
  const parsed = classSpeakingGradingPayloadSchema.safeParse(record.job.payload);
  if (!parsed.success) return false;
  const payload = parsed.data;
  const association = payload.ownership.associations;
  const parent = {
    kind: 'class',
    id: input.prompt.sectionId,
    courseId: input.courseId,
    parentId: input.classId,
  };
  if (
    payload.grant.id !== operationId ||
    payload.recordingId !== input.recording.id ||
    payload.recordingCreatedAt !== input.recording.createdAt.getTime() ||
    payload.storage.consumer !== `recording:${input.recording.id}:audio` ||
    payload.storage.reference !== payload.ownership.reference ||
    association.recordingId !== input.recording.id ||
    association.createdAt !== input.recording.createdAt.getTime() ||
    association.userId !== input.userId ||
    association.prompt.promptId !== input.prompt.id ||
    association.prompt.createdAt !== input.prompt.createdAt.getTime() ||
    !isDeepStrictEqual(association.parents, [parent]) ||
    !isDeepStrictEqual(association.prompt.parents, [parent]) ||
    payload.classAuthorization.classId !== input.classId ||
    !isDeepStrictEqual(payload.classAuthorization.authorization, input.authorization) ||
    !record.job.scopes.some((scope) => scope.subjectId === `class:${input.classId}`)
  )
    return false;
  if (
    !(await resolveOwnedClassStorage(database, {
      classId: input.classId,
      courseId: input.courseId,
      userId: input.userId,
      original: payload.storage,
      currentReference: input.recording.audioUrl,
    }))
  )
    return false;
  if (!(await lockPracticeGrant(database, operationId, 'speaking'))) return false;
  const grant = await learningPreparationGrant(
    database,
    { id: operationId, userId: input.userId, courseId: input.courseId },
    'speaking'
  ).read(payload.grant);
  if (
    grant.status !== 'completed' ||
    grant.attempts.some((attempt) => ['admitted', 'unknown'].includes(attempt.outcome))
  )
    return false;
  return hasSettledSottoExecution(database, {
    id: operationId,
    fingerprint: record.fingerprint,
  });
}
