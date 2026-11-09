import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { hasSettledSottoExecution } from '@/lib/sidedoor/jobs/core/job-settlement-proof';
import { assessmentSpeakingGradingPayloadSchema } from '@/lib/sidedoor/jobs/stitch/speaking-grading-work';
import { captureSpeakingRecordingStorage } from '@/lib/sidedoor/storage/core/speaking-storage';
import { AssessmentFenceConflict } from '../../lifecycle/assessment-fence';
import { fenceAssessmentStorageInputs } from '../../lifecycle/assessment-storage-fence';

/** Preserve an admitted recording when its one-shot grading execution fails. */
export async function settleAssessmentSpeakingFailure(
  database: Prisma.TransactionClient,
  identity: { operationId: string; fingerprint: string }
) {
  const outbox = sottoJobOutbox(database);
  const record = await outbox.read(identity.operationId);
  if (
    !record ||
    record.fingerprint !== identity.fingerprint ||
    record.job.id !== identity.operationId ||
    record.job.namespace !== SIDEDOOR_STATE_ID ||
    record.job.handler !== 'speaking-grading' ||
    record.job.version !== 3
  )
    throw new AssessmentFenceConflict();
  if (record.complete) return;
  const payload = assessmentSpeakingGradingPayloadSchema.parse(record.job.payload);
  const input = payload.assessment;
  if (input.operationId !== identity.operationId) throw new AssessmentFenceConflict();
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${input.assessmentId} FOR UPDATE`;
  const recording = await database.speakingRecording.findUnique({
    where: { id: payload.recordingId },
  });
  if (
    !recording ||
    recording.gradingOperationId !== identity.operationId ||
    recording.createdAt.getTime() !== payload.recordingCreatedAt ||
    recording.userId !== input.userId ||
    recording.promptId !== input.promptId ||
    recording.assessmentSectionId !== input.sectionId ||
    recording.attempt !== input.assessmentAttempt ||
    recording.sectionId !== null ||
    recording.practiceSessionId !== null ||
    recording.examSectionId !== null ||
    !isDeepStrictEqual(recording.sttSelection, input.selection)
  )
    throw new AssessmentFenceConflict();
  if (recording.status === 'SCORED' || recording.status === 'FAILED') return;
  if (!['PENDING', 'GRADING', 'UNRESOLVED'].includes(recording.status))
    throw new AssessmentFenceConflict();
  const ownership = await captureSpeakingRecordingStorage(database, recording.id);
  const current = await capturePrerequisiteOwnership(
    database,
    input.classId,
    input.courseId,
    input.userId
  );
  if (
    !isDeepStrictEqual(ownership, payload.ownership) ||
    !isDeepStrictEqual(current.scopes, record.job.scopes)
  )
    throw new AssessmentFenceConflict();
  await fenceAssessmentStorageInputs(database, [payload.storage]);
  const claimId = `${SIDEDOOR_STATE_ID}:assessment-speaking-launch:${identity.operationId}`;
  const rows = await database.$queryRaw<
    { state: unknown }[]
  >`SELECT state FROM "SidedoorState" WHERE id = ${claimId} FOR UPDATE`;
  const claim = z
    .object({ operationId: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict()
    .safeParse(rows[0]?.state);
  if (
    !claim.success ||
    claim.data.operationId !== identity.operationId ||
    claim.data.fingerprint !== identity.fingerprint
  )
    return;
  const settled = await hasSettledSottoExecution(database, {
    id: identity.operationId,
    fingerprint: identity.fingerprint,
  });
  const blocking = await sottoJobExecutions(database).blockingStatus(
    identity.operationId,
    identity.fingerprint
  );
  if (blocking === 'active' || (!settled && blocking === null)) return;
  const authority = learningPreparationGrant(
    database,
    { id: identity.operationId, userId: input.userId, courseId: input.courseId },
    'speaking'
  );
  const grant = await authority.read(payload.grant);
  if (grant.status === 'completed') throw new AssessmentFenceConflict();
  const unresolved = recording.status === 'UNRESOLVED' || !settled || grant.attempts.length > 0;
  await authority.revoke(payload.grant);
  await database.speakingRecording.update({
    where: { id: recording.id },
    data: {
      status: unresolved ? 'UNRESOLVED' : 'FAILED',
      feedback: unresolved
        ? 'The grading outcome is unknown. Your recording is saved.'
        : 'Grading could not start. Your recording is saved.',
    },
  });
  if (
    settled &&
    !grant.attempts.some((attempt) => ['admitted', 'unknown'].includes(attempt.outcome)) &&
    !(await outbox.complete(identity.operationId, identity.fingerprint))
  )
    throw new AssessmentFenceConflict();
}
