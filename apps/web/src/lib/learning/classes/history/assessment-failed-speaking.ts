import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { hasSettledSottoExecution } from '@/lib/sidedoor/jobs/core/job-settlement-proof';
import { assessmentSpeakingGradingPayloadSchema } from '@/lib/sidedoor/jobs/stitch/speaking-grading-work';
import { captureSpeakingRecordingStorage } from '@/lib/sidedoor/storage/core/speaking-storage';
import { matchesPublishedStorageIdentity } from '@/lib/sidedoor/storage/migration/storage-publication';
import { AssessmentFenceConflict, type AssessmentFence } from '../lifecycle/assessment-fence';
import {
  assessmentMaterialDigest,
  type PrivateAssessmentMaterial,
} from '../material/assessment-material';
import {
  lockPracticeGrant,
  readLockedPracticeOutbox,
} from '../practice/assessment-practice-execution';
import {
  assessmentSpeakingInputDigest,
  assessmentSpeakingTaskDigest,
} from '../speaking/assessment-speaking-identity';
import { READ_ALOUD_ASSESSMENT_POLICY } from '../speaking/assessment-speaking-policy';
import {
  assessmentSpeakingGradeDigest,
  assessmentSpeakingReceiptSchema,
} from '../speaking/lifecycle/assessment-speaking-receipt';
import { selectAssessmentSpeakingTask } from '../speaking/assessment-speaking-task';
import { resolveOwnedClassStorage } from '../lifecycle/assessment-storage-relocation';

/** Verify committed speaking evidence against already verified historical material. */
export async function verifyFailedAssessmentSpeaking(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    assessmentId: string;
    execution: SottoProviderExecution;
    material: PrivateAssessmentMaterial;
    generationFence: Pick<AssessmentFence, 'id' | 'assessmentId' | 'status' | 'speakingPolicy'>;
  }
) {
  const isolation = await database.$queryRaw<
    { isolation: string }[]
  >`SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment evidence requires a Serializable transaction.');
  const actor = await input.execution.authorize(database);
  if (actor.userId !== input.execution.userId) throw new AssessmentFenceConflict();
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${input.assessmentId} FOR UPDATE`;
  const assessment = await database.classAssessment.findFirst({
    where: {
      id: input.assessmentId,
      classId: input.classId,
      userId: actor.userId,
      class: { course: { userId: actor.userId } },
    },
    include: {
      class: { select: { attempt: true } },
      submission: { include: { productiveEvidence: true } },
    },
  });
  const material = input.material;
  if (
    !assessment?.submission ||
    assessment.status !== 'COMMITTED' ||
    !assessment.reviewedMaterialDigest ||
    assessment.id !== material.id ||
    assessment.classId !== material.classId ||
    assessment.courseId !== material.courseId ||
    assessment.userId !== material.userId ||
    assessment.classAttempt !== material.classAttempt ||
    assessment.assessmentAttempt !== material.assessmentAttempt ||
    assessment.reviewedMaterialDigest !== assessmentMaterialDigest(material)
  )
    throw new AssessmentFenceConflict();
  const sections = material.sections.filter((section) => section.skill === 'SPEAKING');
  const requirement = material.requirements.skills.SPEAKING;
  if (requirement.state !== 'REQUIRED') {
    if (
      sections.length ||
      assessment.submission.productiveEvidence.some((item) => item.speakingRecordingId !== null)
    )
      throw new AssessmentFenceConflict();
    return [];
  }
  if (
    sections.length !== 1 ||
    sections[0]?.skill !== 'SPEAKING' ||
    sections[0].items.length !== requirement.expectedCount
  )
    throw new AssessmentFenceConflict();
  if (
    input.generationFence.id !== assessment.generationOperationId ||
    input.generationFence.assessmentId !== assessment.id ||
    input.generationFence.status !== 'COMPLETED' ||
    input.generationFence.speakingPolicy !== READ_ALOUD_ASSESSMENT_POLICY
  )
    throw new AssessmentFenceConflict();
  const section = sections[0];
  const savedItems = assessment.submission.productiveEvidence.filter(
    (item) => item.speakingRecordingId !== null
  );
  if (
    savedItems.length !== section.items.length ||
    new Set(savedItems.map((item) => item.promptId)).size !== section.items.length
  )
    throw new AssessmentFenceConflict();
  const verified = [];
  for (const prompt of section.items) {
    const saved = savedItems.find((item) => item.promptId === prompt.id);
    if (
      !saved?.speakingRecordingId ||
      saved.writingResponseId !== null ||
      saved.sectionId !== section.id ||
      saved.materialDigest !== assessment.reviewedMaterialDigest
    )
      throw new AssessmentFenceConflict();
    await database.$queryRaw`SELECT id FROM "SpeakingRecording" WHERE id = ${saved.speakingRecordingId} FOR UPDATE`;
    const record = await readLockedPracticeOutbox(database, saved.operationId);
    if (
      !record ||
      !record.complete ||
      record.fingerprint !== saved.operationFingerprint ||
      record.job.id !== saved.operationId ||
      record.job.namespace !== SIDEDOOR_STATE_ID ||
      record.job.handler !== 'speaking-grading' ||
      record.job.version !== 3 ||
      !(await lockPracticeGrant(database, saved.operationId, 'speaking'))
    )
      throw new AssessmentFenceConflict();
    const payload = assessmentSpeakingGradingPayloadSchema.parse(record.job.payload);
    const binding = payload.assessment;
    const task = selectAssessmentSpeakingTask(
      {
        material,
        scope: {
          id: assessment.id,
          classId: assessment.classId,
          courseId: assessment.courseId,
          userId: assessment.userId,
          classAttempt: assessment.classAttempt,
          assessmentAttempt: assessment.assessmentAttempt,
          reviewedMaterialDigest: assessment.reviewedMaterialDigest,
          requirements: material.requirements,
        },
      },
      prompt.id
    );
    if (
      binding.speakingPolicy !== READ_ALOUD_ASSESSMENT_POLICY ||
      binding.operationId !== saved.operationId ||
      binding.recordingId !== saved.speakingRecordingId ||
      binding.assessmentId !== assessment.id ||
      binding.classId !== assessment.classId ||
      binding.courseId !== assessment.courseId ||
      binding.userId !== assessment.userId ||
      binding.classAttempt !== assessment.classAttempt ||
      binding.assessmentAttempt !== assessment.assessmentAttempt ||
      binding.sectionId !== section.id ||
      binding.promptId !== prompt.id ||
      binding.materialDigest !== assessment.reviewedMaterialDigest ||
      binding.taskDigest !== assessmentSpeakingTaskDigest(task) ||
      assessmentSpeakingInputDigest(binding) !== saved.inputDigest
    )
      throw new AssessmentFenceConflict();
    const recording = await database.speakingRecording.findUnique({
      where: { id: saved.speakingRecordingId },
    });
    if (
      !recording ||
      recording.status !== 'SCORED' ||
      recording.gradingOperationId !== saved.operationId ||
      recording.createdAt.getTime() !== payload.recordingCreatedAt ||
      recording.userId !== assessment.userId ||
      recording.promptId !== prompt.id ||
      recording.assessmentSectionId !== section.id ||
      recording.attempt !== assessment.assessmentAttempt ||
      recording.sectionId !== null ||
      recording.practiceSessionId !== null ||
      recording.examSectionId !== null ||
      !isDeepStrictEqual(recording.sttSelection, binding.selection) ||
      recording.transcript === null ||
      recording.overallScore === null ||
      recording.rubricScores === null ||
      recording.phonemeScores === null ||
      recording.feedback === null
    )
      throw new AssessmentFenceConflict();
    const ownership = await capturePrerequisiteOwnership(
      database,
      assessment.classId,
      assessment.courseId,
      assessment.userId
    );
    const recordingOwnership = await captureSpeakingRecordingStorage(database, recording.id);
    const expectedOwnership = structuredClone(payload.ownership);
    expectedOwnership.reference = recordingOwnership.reference;
    for (const parent of [
      ...expectedOwnership.associations.parents,
      ...expectedOwnership.associations.prompt.parents,
    ]) {
      if (!parent.assessment) throw new AssessmentFenceConflict();
      if (
        parent.assessment.currentClassAttempt !== assessment.classAttempt ||
        assessment.class.attempt < assessment.classAttempt
      )
        throw new AssessmentFenceConflict();
      parent.assessment.status = 'COMMITTED';
      parent.assessment.currentClassAttempt = assessment.class.attempt;
    }
    const storage = await resolveOwnedClassStorage(database, {
      classId: assessment.classId,
      courseId: assessment.courseId,
      userId: assessment.userId,
      original: payload.storage,
      currentReference: recordingOwnership.reference,
    });
    if (
      !isDeepStrictEqual(ownership.scopes, record.job.scopes) ||
      !isDeepStrictEqual(recordingOwnership, expectedOwnership) ||
      !matchesPublishedStorageIdentity(storage, {
        original: payload.storage,
        currentReference: recordingOwnership.reference,
        contentSha256: binding.audio.sha256,
        contentBytes: binding.audio.bytes,
      })
    )
      throw new AssessmentFenceConflict();
    const claim = await database.sidedoorState.findUnique({
      where: { id: `${SIDEDOOR_STATE_ID}:assessment-speaking-launch:${saved.operationId}` },
    });
    const parsedClaim = z
      .object({ operationId: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .safeParse(claim?.state);
    if (
      !parsedClaim.success ||
      parsedClaim.data.operationId !== saved.operationId ||
      parsedClaim.data.fingerprint !== saved.operationFingerprint
    )
      throw new AssessmentFenceConflict();
    const grant = await learningPreparationGrant(
      database,
      { id: saved.operationId, userId: assessment.userId, courseId: assessment.courseId },
      'speaking'
    ).read(payload.grant);
    if (
      grant.status !== 'completed' ||
      grant.attempts.filter((attempt) => attempt.outcome === 'succeeded').length < 2 ||
      grant.attempts.some((attempt) => ['admitted', 'unknown'].includes(attempt.outcome)) ||
      !(await hasSettledSottoExecution(database, {
        id: saved.operationId,
        fingerprint: saved.operationFingerprint,
      }))
    )
      throw new AssessmentFenceConflict();
    const page = await sottoJobSnapshot(database).read(
      saved.operationId,
      saved.operationFingerprint,
      0
    );
    if (page.pages !== 1 || page.next !== null || page.items.length !== 1)
      throw new AssessmentFenceConflict();
    const receipt = assessmentSpeakingReceiptSchema.parse(page.items[0]);
    if (
      !isDeepStrictEqual(saved.snapshot, receipt) ||
      receipt.operationId !== saved.operationId ||
      receipt.fingerprint !== saved.operationFingerprint ||
      receipt.recordingId !== recording.id ||
      receipt.inputDigest !== saved.inputDigest ||
      receipt.score !== saved.score ||
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
    verified.push({
      assessmentId: assessment.id,
      userId: assessment.userId,
      classAttempt: assessment.classAttempt,
      assessmentAttempt: assessment.assessmentAttempt,
      itemId: prompt.id,
      sectionId: section.id,
      operationId: saved.operationId,
      status: 'SCORED' as const,
      materialDigest: saved.materialDigest,
      score: saved.score,
    });
  }
  const finalActor = await input.execution.authorize(database);
  if (finalActor.userId !== actor.userId) throw new AssessmentFenceConflict();
  input.execution.signal?.throwIfAborted();
  return verified;
}
