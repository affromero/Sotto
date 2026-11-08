import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { captureSpeakingRecordingStorage } from '@/lib/sidedoor/storage/core/speaking-storage';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  classSpeakingGradingPayloadSchema,
  speakingGradingPayloadSchema,
} from './speaking-grading-work';

/** Old class jobs have no attempt journal, so a failed delivery cannot be replayed safely. */
export async function settleFailedLegacyClassSpeaking(
  database: Prisma.TransactionClient,
  observation: {
    operationId: string;
    fingerprint: string;
    handler: string;
    version: number;
    state: string;
  }
): Promise<boolean> {
  if (
    observation.handler !== 'speaking-grading' ||
    observation.version !== 1 ||
    observation.state !== 'failed'
  )
    throw new Error('Legacy speaking failure observation changed');
  const outbox = sottoJobOutbox(database);
  const record = await outbox.read(observation.operationId);
  if (
    !record ||
    record.fingerprint !== observation.fingerprint ||
    record.job.handler !== observation.handler ||
    record.job.version !== 1
  )
    throw new Error('Legacy speaking failure does not match durable work');
  if (record.complete) return true;
  const payload = speakingGradingPayloadSchema.parse(record.job.payload);
  const parent = payload.ownership.associations.parents.find(
    (candidate) => candidate.kind === 'class'
  );
  if (!parent) return false;
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${parent.parentId} FOR UPDATE`;
  const recording = await database.speakingRecording.findUnique({
    where: { id: payload.recordingId },
  });
  if (
    !recording ||
    (recording.gradingOperationId !== null &&
      recording.gradingOperationId !== observation.operationId) ||
    recording.createdAt.getTime() !== payload.recordingCreatedAt ||
    recording.userId !== payload.ownership.associations.userId ||
    recording.sectionId !== parent.id ||
    !['PENDING', 'GRADING', 'UNRESOLVED'].includes(recording.status)
  )
    throw new Error('Legacy speaking failure recording changed');
  if (
    !isDeepStrictEqual(
      await captureSpeakingRecordingStorage(database, recording.id),
      payload.ownership
    )
  )
    throw new Error('Legacy speaking failure storage ownership changed');
  await capturePrerequisiteOwnership(database, parent.parentId, parent.courseId, recording.userId);
  const blocker = await sottoJobExecutions(database).blockingStatus(
    observation.operationId,
    observation.fingerprint
  );
  if (blocker) return false;
  await sottoJobExecutions(database).requireParentDrained(
    observation.operationId,
    observation.fingerprint
  );
  await database.speakingRecording.update({
    where: { id: recording.id },
    data: {
      status: 'UNRESOLVED',
      gradingOperationId: observation.operationId,
      feedback: 'The grading outcome is unknown. Your recording is saved.',
    },
  });
  if (!(await outbox.complete(observation.operationId, observation.fingerprint)))
    throw new Error('Legacy speaking failure work was already completed');
  return true;
}

/** Settle a verified terminal delivery without dispatching or inferring provider outcome. */
export async function settleFailedClassSpeaking(
  database: Prisma.TransactionClient,
  observation: {
    operationId: string;
    fingerprint: string;
    handler: string;
    version: number;
    state: string;
  }
): Promise<boolean> {
  if (
    observation.handler !== 'speaking-grading' ||
    observation.version !== 2 ||
    observation.state !== 'failed'
  )
    throw new Error('Speaking failure observation does not match the class contract');
  const outbox = sottoJobOutbox(database);
  const record = await outbox.read(observation.operationId);
  if (
    !record ||
    record.fingerprint !== observation.fingerprint ||
    record.job.handler !== observation.handler ||
    record.job.version !== 2
  )
    throw new Error('Speaking failure does not match durable work');
  if (record.complete) return true;
  const payload = classSpeakingGradingPayloadSchema.parse(record.job.payload);
  if (payload.grant.id !== observation.operationId)
    throw new Error('Speaking failure grant changed');
  const parent = payload.ownership.associations.parents.find(
    (candidate) =>
      candidate.kind === 'class' && candidate.parentId === payload.classAuthorization.classId
  );
  if (!parent) throw new Error('Speaking failure class ownership changed');
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${parent.parentId} FOR UPDATE`;
  const recording = await database.speakingRecording.findUnique({
    where: { id: payload.recordingId },
  });
  if (
    !recording ||
    recording.gradingOperationId !== observation.operationId ||
    recording.createdAt.getTime() !== payload.recordingCreatedAt ||
    recording.userId !== payload.ownership.associations.userId ||
    recording.sectionId !== parent.id ||
    !['PENDING', 'GRADING', 'UNRESOLVED'].includes(recording.status)
  )
    throw new Error('Speaking failure recording changed');
  const ownership = await captureSpeakingRecordingStorage(database, recording.id);
  if (!isDeepStrictEqual(ownership, payload.ownership))
    throw new Error('Speaking failure storage ownership changed');
  const classOwnership = await capturePrerequisiteOwnership(
    database,
    parent.parentId,
    parent.courseId,
    recording.userId
  );
  const classScope = classOwnership.scopes.find(
    (scope) => scope.subjectId === `class:${parent.parentId}`
  );
  if (!classScope || !record.job.scopes.some((scope) => isDeepStrictEqual(scope, classScope)))
    throw new Error('Speaking failure class scope changed');
  const authority = learningPreparationGrant(
    database,
    {
      id: observation.operationId,
      userId: recording.userId,
      courseId: parent.courseId,
    },
    'speaking'
  );
  const grant = await authority.read(payload.grant);
  if (grant.status === 'completed') throw new Error('Speaking failure grant is already complete');
  const blocking = await sottoJobExecutions(database).blockingStatus(
    observation.operationId,
    observation.fingerprint
  );
  const unresolved = grant.attempts.length > 0 || blocking !== null;
  await authority.revoke(payload.grant);
  await database.speakingRecording.update({
    where: { id: recording.id },
    data: unresolved
      ? {
          status: 'UNRESOLVED',
          feedback: 'The grading outcome is unknown. Your recording is saved.',
        }
      : { status: 'FAILED', feedback: 'Grading could not start. Record another attempt.' },
  });
  if (!(await outbox.complete(observation.operationId, observation.fingerprint)))
    throw new Error('Speaking failure work was already completed');
  return true;
}
