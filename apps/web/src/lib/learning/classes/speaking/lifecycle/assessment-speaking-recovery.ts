import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { hasSettledSottoExecution } from '@/lib/sidedoor/jobs/core/job-settlement-proof';
import { assessmentSpeakingGradingPayloadSchema } from '@/lib/sidedoor/jobs/stitch/speaking-grading-work';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import { captureSpeakingRecordingStorage } from '@/lib/sidedoor/storage/core/speaking-storage';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { AssessmentFenceConflict } from '../../lifecycle/assessment-fence';
import {
  assessmentSpeakingInputDigest,
  assessmentSpeakingTaskDigest,
} from '../assessment-speaking-identity';
import {
  assessmentSpeakingGradeDigest,
  assessmentSpeakingReceiptSchema,
} from './assessment-speaking-receipt';
import { captureAssessmentSpeakingTask } from '../assessment-speaking-task';
import { fenceAssessmentStorageInputs } from '../../lifecycle/assessment-storage-fence';
import {
  lockPracticeGrant,
  readLockedPracticeOutbox,
} from '../../practice/assessment-practice-execution';
import { captureAssessmentSpeakingWork } from '../assessment-speaking-work';
import { verifyFailedSpeakingForDeletion } from './assessment-speaking-failed-verification';

/** Read an owned response without disclosing its assessment feedback. */
export async function readAssessmentSpeakingStatus(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    assessmentId: string;
    promptId: string;
    execution: SottoProviderExecution;
  }
) {
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${input.assessmentId} FOR UPDATE`;
  const captured = await captureAssessmentSpeakingTask(database, input);
  const actor = await input.execution.authorize(database);
  const task = captured.task;
  if (actor.userId !== input.execution.userId || actor.userId !== task.userId)
    throw new AssessmentFenceConflict();
  const recordings = await database.speakingRecording.findMany({
    where: {
      assessmentSectionId: task.sectionId,
      promptId: input.promptId,
      attempt: task.assessmentAttempt,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (!recordings.length) return { status: 'NOT_STARTED' as const };
  const remaining = recordings.filter((recording) => recording.status !== 'FAILED');
  if (remaining.length > 1) throw new AssessmentFenceConflict();
  for (const failed of recordings.filter((recording) => recording.status === 'FAILED')) {
    if (failed.userId !== actor.userId || !failed.gradingOperationId)
      throw new AssessmentFenceConflict();
    const prior = await sottoJobOutbox(database).read(failed.gradingOperationId);
    if (!prior) throw new AssessmentFenceConflict();
    await verifyFailedSpeakingForDeletion(database, {
      classId: input.classId,
      courseId: task.courseId,
      userId: actor.userId,
      assessmentId: input.assessmentId,
      recordingId: failed.id,
      operationId: prior.job.id,
      fingerprint: prior.fingerprint,
    });
    await sottoJobExecutions(database).requireParentDrained(prior.job.id, prior.fingerprint);
  }
  if (!remaining.length)
    return { status: 'FAILED' as const, requestId: recordings[recordings.length - 1]!.id };
  const recording = remaining[0]!;
  if (recording.userId !== actor.userId || !recording.gradingOperationId)
    throw new AssessmentFenceConflict();
  const record = await sottoJobOutbox(database).read(recording.gradingOperationId);
  if (
    !record ||
    record.job.id !== recording.gradingOperationId ||
    record.job.handler !== 'speaking-grading' ||
    record.job.version !== 3
  )
    throw new AssessmentFenceConflict();
  const payload = assessmentSpeakingGradingPayloadSchema.parse(record.job.payload);
  const binding = payload.assessment;
  if (
    binding.recordingId !== recording.id ||
    binding.operationId !== recording.gradingOperationId ||
    binding.userId !== actor.userId ||
    binding.classId !== input.classId ||
    binding.assessmentId !== input.assessmentId ||
    binding.promptId !== input.promptId ||
    binding.taskDigest !== assessmentSpeakingTaskDigest(task)
  )
    throw new AssessmentFenceConflict();
  const identity = { operationId: record.job.id, fingerprint: record.fingerprint };
  if (recording.status === 'SCORED') {
    const verified = await verifyCompletedAssessmentSpeaking(
      database,
      identity,
      input.execution.signal
    );
    return {
      status: verified?.record.complete ? ('COMPLETED' as const) : ('UNRESOLVED' as const),
      requestId: recording.id,
    };
  }
  if (recording.status === 'PENDING' || recording.status === 'GRADING') {
    const grant = await learningPreparationGrant(
      database,
      { id: identity.operationId, userId: actor.userId, courseId: task.courseId },
      'speaking'
    ).read(payload.grant);
    if (record.complete || grant.status !== 'active' || grant.grant.expiresAt <= Date.now())
      return { status: 'UNRESOLVED' as const, requestId: recording.id };
    await captureAssessmentSpeakingWork(database, { ...identity, execution: input.execution });
    return { status: 'RUNNING' as const, requestId: recording.id };
  }
  return { status: 'UNRESOLVED' as const, requestId: recording.id };
}

/** Verify the retained result whether or not queue completion has been recorded. */
export async function verifyCompletedAssessmentSpeaking(
  database: Prisma.TransactionClient,
  identity: { operationId: string; fingerprint: string },
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const record = await sottoJobOutbox(database).read(identity.operationId);
  if (
    !record ||
    record.fingerprint !== identity.fingerprint ||
    record.job.id !== identity.operationId ||
    record.job.namespace !== SIDEDOOR_STATE_ID ||
    record.job.handler !== 'speaking-grading' ||
    record.job.version !== 3
  )
    throw new AssessmentFenceConflict();
  const payload = assessmentSpeakingGradingPayloadSchema.parse(record.job.payload);
  const input = payload.assessment;
  if (input.operationId !== identity.operationId) throw new AssessmentFenceConflict();
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${input.assessmentId} FOR UPDATE`;
  if (!isDeepStrictEqual(await readLockedPracticeOutbox(database, identity.operationId), record))
    throw new AssessmentFenceConflict();
  const execution: SottoProviderExecution = {
    userId: input.userId,
    signal,
    authorize: async (tx) => {
      const ownership = await capturePrerequisiteOwnership(
        tx,
        input.classId,
        input.courseId,
        input.userId
      );
      if (
        ownership.instanceId !== payload.ownership.instanceId ||
        !isDeepStrictEqual(ownership.scopes, record.job.scopes)
      )
        throw new AssessmentFenceConflict();
      return { userId: input.userId };
    },
  };
  const task = await captureAssessmentSpeakingTask(database, {
    classId: input.classId,
    assessmentId: input.assessmentId,
    promptId: input.promptId,
    execution,
  });
  if (
    task.speakingPolicy !== input.speakingPolicy ||
    assessmentSpeakingTaskDigest(task.task) !== input.taskDigest ||
    task.task.materialDigest !== input.materialDigest
  )
    throw new AssessmentFenceConflict();
  await database.$queryRaw`SELECT id FROM "SpeakingRecording" WHERE id = ${payload.recordingId} FOR UPDATE`;
  const recording = await database.speakingRecording.findUnique({
    where: { id: payload.recordingId },
  });
  if (
    !recording ||
    recording.status !== 'SCORED' ||
    recording.gradingOperationId !== identity.operationId ||
    recording.createdAt.getTime() !== payload.recordingCreatedAt ||
    recording.userId !== input.userId ||
    recording.promptId !== input.promptId ||
    recording.assessmentSectionId !== input.sectionId ||
    recording.attempt !== input.assessmentAttempt ||
    recording.sectionId !== null ||
    recording.practiceSessionId !== null ||
    recording.examSectionId !== null ||
    !isDeepStrictEqual(recording.sttSelection, input.selection) ||
    recording.transcript === null ||
    recording.overallScore === null ||
    recording.rubricScores === null ||
    recording.phonemeScores === null ||
    recording.feedback === null
  )
    throw new AssessmentFenceConflict();
  const ownership = await captureSpeakingRecordingStorage(database, recording.id);
  await fenceAssessmentStorageInputs(database, [payload.storage]);
  const storage = await resolveStorageInput(database, {
    consumer: payload.storage.consumer,
    reference: recording.audioUrl,
  });
  if (
    !isDeepStrictEqual(ownership, payload.ownership) ||
    !isDeepStrictEqual(storage.input, payload.storage)
  )
    throw new AssessmentFenceConflict();
  const claim = await database.sidedoorState.findUnique({
    where: { id: `${SIDEDOOR_STATE_ID}:assessment-speaking-launch:${identity.operationId}` },
  });
  const parsedClaim = z
    .object({ operationId: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict()
    .safeParse(claim?.state);
  if (
    !parsedClaim.success ||
    parsedClaim.data.operationId !== identity.operationId ||
    parsedClaim.data.fingerprint !== identity.fingerprint
  )
    throw new AssessmentFenceConflict();
  if (!(await lockPracticeGrant(database, identity.operationId, 'speaking')))
    throw new AssessmentFenceConflict();
  const grant = await learningPreparationGrant(
    database,
    {
      id: identity.operationId,
      userId: input.userId,
      courseId: input.courseId,
    },
    'speaking'
  ).read(payload.grant);
  if (
    grant.status !== 'completed' ||
    grant.attempts.filter((attempt) => attempt.outcome === 'succeeded').length < 2 ||
    grant.attempts.some((attempt) => ['admitted', 'unknown'].includes(attempt.outcome)) ||
    !(await hasSettledSottoExecution(database, {
      id: identity.operationId,
      fingerprint: identity.fingerprint,
    }))
  )
    return null;
  const page = await sottoJobSnapshot(database).read(identity.operationId, identity.fingerprint, 0);
  if (page.pages !== 1 || page.next !== null || page.items.length !== 1)
    throw new AssessmentFenceConflict();
  const receipt = assessmentSpeakingReceiptSchema.parse(page.items[0]);
  if (
    receipt.operationId !== identity.operationId ||
    receipt.fingerprint !== identity.fingerprint ||
    receipt.recordingId !== recording.id ||
    receipt.inputDigest !== assessmentSpeakingInputDigest(input) ||
    receipt.score !== recording.overallScore ||
    receipt.gradeDigest !==
      assessmentSpeakingGradeDigest({
        transcript: recording.transcript,
        overallScore: recording.overallScore,
        rubricScores: recording.rubricScores,
        phonemeScores: recording.phonemeScores,
        feedback: recording.feedback,
      })
  )
    throw new AssessmentFenceConflict();
  await execution.authorize(database);
  signal?.throwIfAborted();
  return { record, payload, receipt, recording };
}

/** Settle an already graded, drained job without making another provider request. */
export async function settleCompletedAssessmentSpeaking(
  database: Prisma.TransactionClient,
  identity: { operationId: string; fingerprint: string },
  signal?: AbortSignal
) {
  const verified = await verifyCompletedAssessmentSpeaking(database, identity, signal);
  if (!verified) return false;
  if (
    !verified.record.complete &&
    !(await sottoJobOutbox(database).complete(identity.operationId, identity.fingerprint))
  )
    throw new AssessmentFenceConflict();
  return true;
}
