import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { assessmentSpeakingGradingPayloadSchema } from '@/lib/sidedoor/jobs/stitch/speaking-grading-work';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import { captureSpeakingRecordingStorage } from '@/lib/sidedoor/storage/core/speaking-storage';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { assessmentSpeakingTaskDigest } from './assessment-speaking-identity';
import { captureAssessmentSpeakingTask } from './assessment-speaking-task';
import { fenceAssessmentStorageInputs } from '../lifecycle/assessment-storage-fence';

/** Recheck every durable input before a speaking worker performs or publishes work. */
export async function captureAssessmentSpeakingWork(
  database: Prisma.TransactionClient,
  input: { operationId: string; fingerprint: string; execution: SottoProviderExecution }
) {
  input.execution.signal?.throwIfAborted();
  const actor = await input.execution.authorize(database);
  if (actor.userId !== input.execution.userId) throw new AssessmentFenceConflict();
  const record = await sottoJobOutbox(database).read(input.operationId);
  if (
    !record ||
    record.complete ||
    record.fingerprint !== input.fingerprint ||
    record.job.id !== input.operationId ||
    record.job.namespace !== SIDEDOOR_STATE_ID ||
    record.job.handler !== 'speaking-grading' ||
    record.job.version !== 3
  )
    throw new AssessmentFenceConflict();
  const payload = assessmentSpeakingGradingPayloadSchema.parse(record.job.payload);
  const identity = payload.assessment;
  if (identity.operationId !== input.operationId || identity.userId !== actor.userId)
    throw new AssessmentFenceConflict();
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${identity.classId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${identity.assessmentId} FOR UPDATE`;
  const captured = await captureAssessmentSpeakingTask(database, {
    classId: identity.classId,
    assessmentId: identity.assessmentId,
    promptId: identity.promptId,
    execution: input.execution,
  });
  const task = captured.task;
  if (
    captured.speakingPolicy !== identity.speakingPolicy ||
    task.assessmentId !== identity.assessmentId ||
    task.classId !== identity.classId ||
    task.courseId !== identity.courseId ||
    task.userId !== identity.userId ||
    task.classAttempt !== identity.classAttempt ||
    task.assessmentAttempt !== identity.assessmentAttempt ||
    task.sectionId !== identity.sectionId ||
    task.prompt.id !== identity.promptId ||
    task.materialDigest !== identity.materialDigest ||
    assessmentSpeakingTaskDigest(task) !== identity.taskDigest
  )
    throw new AssessmentFenceConflict();
  const recording = await database.speakingRecording.findUnique({
    where: { id: identity.recordingId },
  });
  if (
    !recording ||
    !['PENDING', 'GRADING'].includes(recording.status) ||
    recording.gradingOperationId !== input.operationId ||
    recording.userId !== actor.userId ||
    recording.promptId !== identity.promptId ||
    recording.assessmentSectionId !== identity.sectionId ||
    recording.sectionId !== null ||
    recording.practiceSessionId !== null ||
    recording.examSectionId !== null ||
    recording.attempt !== identity.assessmentAttempt ||
    recording.createdAt.getTime() !== payload.recordingCreatedAt ||
    !isDeepStrictEqual(recording.sttSelection, identity.selection)
  )
    throw new AssessmentFenceConflict();
  const ownership = await captureSpeakingRecordingStorage(database, recording.id);
  await fenceAssessmentStorageInputs(database, [payload.storage]);
  const storage = await resolveStorageInput(database, {
    consumer: `recording:${recording.id}:audio`,
    reference: recording.audioUrl,
  });
  if (
    !isDeepStrictEqual(ownership, payload.ownership) ||
    !isDeepStrictEqual(ownership.scopes, record.job.scopes) ||
    !isDeepStrictEqual(storage.input, payload.storage)
  )
    throw new AssessmentFenceConflict();
  const grant = await learningPreparationGrant(
    database,
    {
      id: input.operationId,
      userId: actor.userId,
      courseId: identity.courseId,
    },
    'speaking'
  ).read(payload.grant);
  if (grant.status !== 'active' || grant.grant.expiresAt <= Date.now())
    throw new AssessmentFenceConflict();
  const finalActor = await input.execution.authorize(database);
  if (finalActor.userId !== actor.userId) throw new AssessmentFenceConflict();
  input.execution.signal?.throwIfAborted();
  return { payload, task, backend: storage.backend, grant };
}

/** Check downloaded bytes against the originally admitted recording before transcription. */
export function verifyAssessmentSpeakingAudio(
  bytes: Uint8Array,
  expected: { bytes: number; sha256: string }
) {
  if (
    bytes.byteLength !== expected.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== expected.sha256
  )
    throw new AssessmentFenceConflict();
}
