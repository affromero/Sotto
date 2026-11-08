import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { hasSettledSottoExecution } from '@/lib/sidedoor/jobs/core/job-settlement-proof';
import { assessmentSpeakingGradingPayloadSchema } from '@/lib/sidedoor/jobs/stitch/speaking-grading-work';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import { captureSpeakingRecordingStorage } from '@/lib/sidedoor/storage/core/speaking-storage';
import { matchesPublishedStorageIdentity } from '@/lib/sidedoor/storage/migration/storage-publication';
import { AssessmentFenceConflict } from '../../lifecycle/assessment-fence';
import {
  assessmentMaterialDigest,
  type PrivateAssessmentMaterial,
} from '../../material/assessment-material';
import { assessmentSpeakingTaskDigest } from '../assessment-speaking-identity';
import {
  captureAssessmentSpeakingTask,
  selectAssessmentSpeakingTask,
} from '../assessment-speaking-task';
import { fenceAssessmentStorageInputs } from '../../lifecycle/assessment-storage-fence';
import { resolveOwnedClassStorage } from '../../lifecycle/assessment-storage-relocation';
import {
  lockPracticeGrant,
  readLockedPracticeOutbox,
} from '../../practice/assessment-practice-execution';
import { observeExecutionGate } from '../../lifecycle/assessment-unresolved';
import {
  assessmentSpeakingPrelaunchReceiptId,
  assessmentSpeakingPrelaunchReceiptSchema,
} from './assessment-speaking-prelaunch-receipt';

export type AssessmentSpeakingDeletionInput = {
  classId: string;
  courseId: string;
  userId: string;
  assessmentId: string;
  recordingId: string;
  operationId: string;
  fingerprint: string;
};

/** Confirm grading stopped before making any provider request for an authenticated owner. */
export async function verifyFailedSpeakingForDeletion(
  database: Prisma.TransactionClient,
  input: AssessmentSpeakingDeletionInput,
  historical?: { material: PrivateAssessmentMaterial; speakingPolicy?: string }
) {
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment speaking verification requires a Serializable transaction.');
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${input.assessmentId} FOR UPDATE`;
  const record = await readLockedPracticeOutbox(database, input.operationId);
  if (
    !record ||
    !record.complete ||
    record.fingerprint !== input.fingerprint ||
    record.job.id !== input.operationId ||
    record.job.namespace !== SIDEDOOR_STATE_ID ||
    record.job.handler !== 'speaking-grading' ||
    record.job.version !== 3 ||
    !(await lockPracticeGrant(database, input.operationId, 'speaking'))
  )
    throw new AssessmentFenceConflict();
  const payload = assessmentSpeakingGradingPayloadSchema.parse(record.job.payload);
  const binding = payload.assessment;
  if (
    binding.operationId !== input.operationId ||
    binding.recordingId !== input.recordingId ||
    binding.classId !== input.classId ||
    binding.courseId !== input.courseId ||
    binding.userId !== input.userId ||
    binding.assessmentId !== input.assessmentId
  )
    throw new AssessmentFenceConflict();
  const execution = {
    userId: input.userId,
    authorize: async (tx: Prisma.TransactionClient) => {
      await capturePrerequisiteOwnership(tx, input.classId, input.courseId, input.userId);
      return { userId: input.userId };
    },
  };
  const assessment = historical
    ? await database.classAssessment.findFirst({
        where: {
          id: input.assessmentId,
          classId: input.classId,
          courseId: input.courseId,
          userId: input.userId,
          status: 'COMMITTED',
        },
        include: { class: { select: { attempt: true } } },
      })
    : null;
  if (
    historical &&
    (!assessment ||
      assessment.reviewedMaterialDigest !== assessmentMaterialDigest(historical.material))
  )
    throw new AssessmentFenceConflict();
  const task =
    historical && assessment
      ? {
          speakingPolicy: historical.speakingPolicy,
          task: selectAssessmentSpeakingTask(
            {
              material: historical.material,
              scope: {
                id: assessment.id,
                classId: assessment.classId,
                courseId: assessment.courseId,
                userId: assessment.userId,
                classAttempt: assessment.classAttempt,
                assessmentAttempt: assessment.assessmentAttempt,
                reviewedMaterialDigest: assessment.reviewedMaterialDigest!,
                requirements: historical.material.requirements,
              },
            },
            binding.promptId
          ),
        }
      : await captureAssessmentSpeakingTask(database, {
          classId: input.classId,
          assessmentId: input.assessmentId,
          promptId: binding.promptId,
          execution,
        });
  const recording = await database.speakingRecording.findUnique({
    where: { id: input.recordingId },
  });
  if (
    task.speakingPolicy !== binding.speakingPolicy ||
    assessmentSpeakingTaskDigest(task.task) !== binding.taskDigest ||
    task.task.materialDigest !== binding.materialDigest ||
    !recording ||
    recording.status !== 'FAILED' ||
    recording.gradingOperationId !== input.operationId ||
    recording.createdAt.getTime() !== payload.recordingCreatedAt ||
    recording.userId !== input.userId ||
    recording.promptId !== binding.promptId ||
    recording.assessmentSectionId !== binding.sectionId ||
    recording.attempt !== binding.assessmentAttempt ||
    recording.sectionId !== null ||
    recording.practiceSessionId !== null ||
    recording.examSectionId !== null ||
    recording.transcript !== null ||
    recording.overallScore !== null ||
    recording.rubricScores !== null ||
    recording.phonemeScores !== null ||
    !isDeepStrictEqual(recording.sttSelection, binding.selection)
  )
    throw new AssessmentFenceConflict();
  if (
    await database.classAssessmentProductiveEvidence.count({
      where: { speakingRecordingId: input.recordingId },
    })
  )
    throw new AssessmentFenceConflict();
  const ownership = await captureSpeakingRecordingStorage(database, recording.id);
  const expectedOwnership = structuredClone(payload.ownership);
  if (historical && assessment) {
    expectedOwnership.reference = ownership.reference;
    for (const parent of [
      ...expectedOwnership.associations.parents,
      ...expectedOwnership.associations.prompt.parents,
    ]) {
      if (
        !parent.assessment ||
        parent.assessment.currentClassAttempt !== assessment.classAttempt ||
        assessment.class.attempt < assessment.classAttempt
      )
        throw new AssessmentFenceConflict();
      parent.assessment.status = 'COMMITTED';
      parent.assessment.currentClassAttempt = assessment.class.attempt;
    }
  }
  if (!historical) await fenceAssessmentStorageInputs(database, [payload.storage]);
  const validStorage = historical
    ? matchesPublishedStorageIdentity(
        await resolveOwnedClassStorage(database, {
          classId: input.classId,
          courseId: input.courseId,
          userId: input.userId,
          original: payload.storage,
          currentReference: ownership.reference,
        }),
        {
          original: payload.storage,
          currentReference: ownership.reference,
          contentSha256: binding.audio.sha256,
          contentBytes: binding.audio.bytes,
        }
      )
    : isDeepStrictEqual(
        (
          await resolveStorageInput(database, {
            consumer: payload.storage.consumer,
            reference: recording.audioUrl,
          })
        ).input,
        payload.storage
      );
  if (
    !isDeepStrictEqual(ownership, expectedOwnership) ||
    !isDeepStrictEqual(ownership.scopes, record.job.scopes) ||
    !validStorage
  )
    throw new AssessmentFenceConflict();
  const claim = await database.sidedoorState.findUnique({
    where: { id: `${SIDEDOOR_STATE_ID}:assessment-speaking-launch:${input.operationId}` },
  });
  const prelaunch = await database.sidedoorState.findUnique({
    where: { id: assessmentSpeakingPrelaunchReceiptId(input.operationId) },
  });
  if (claim) {
    const parsed = z
      .object({ operationId: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .safeParse(claim.state);
    if (
      prelaunch ||
      !parsed.success ||
      parsed.data.operationId !== input.operationId ||
      parsed.data.fingerprint !== input.fingerprint ||
      !(await hasSettledSottoExecution(database, {
        id: input.operationId,
        fingerprint: input.fingerprint,
      }))
    )
      throw new AssessmentFenceConflict();
  } else {
    const receipt = assessmentSpeakingPrelaunchReceiptSchema.safeParse(prelaunch?.state);
    const gate = await observeExecutionGate(database, {
      id: input.operationId,
      fingerprint: input.fingerprint,
    });
    if (
      !receipt.success ||
      receipt.data.operationId !== input.operationId ||
      receipt.data.fingerprint !== input.fingerprint ||
      receipt.data.recordingId !== input.recordingId ||
      receipt.data.assessmentId !== input.assessmentId ||
      receipt.data.classId !== input.classId ||
      receipt.data.courseId !== input.courseId ||
      receipt.data.userId !== input.userId ||
      gate.blocking ||
      gate.revision !== null
    )
      throw new AssessmentFenceConflict();
  }
  const grant = await learningPreparationGrant(
    database,
    { id: input.operationId, userId: input.userId, courseId: input.courseId },
    'speaking'
  ).read(payload.grant);
  if (grant.status !== 'revoked' || grant.attempts.length !== 0)
    throw new AssessmentFenceConflict();
}
