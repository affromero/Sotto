import { isDeepStrictEqual } from 'node:util';
import { classReceiptSchema } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { objectiveEvidenceHash } from '@/lib/learning-map/evidence/protocol';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  assessmentFenceBackend,
  assessmentFenceStore,
  assessmentWorkSchema,
  AssessmentFenceConflict,
} from '../lifecycle/assessment-fence';
import { readVerifiedHistoricalAssessmentGeneration } from '../lifecycle/assessment-outcome';
import { readAssessmentArchive } from './assessment-archive';
import { verifyFailedAssessmentWriting } from './assessment-failed-writing';
import { verifyFailedAssessmentSpeaking } from './assessment-failed-speaking';
import {
  assessmentEvaluationReceipt,
  evaluateRetainedAssessmentMaterial,
} from '../material/assessment-material';

/** Check the retained failed receipt. This does not authorize a new attempt. */
export async function captureFailedAssessmentReceipt(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    assessmentId: string;
    execution: SottoProviderExecution;
  }
) {
  return inspectFailedAssessmentReceipt(database, input, false);
}

/** Verify an earlier result while its class submission is still the current saved receipt. */
export async function verifyHistoricalFailedAssessmentReceipt(
  database: Prisma.TransactionClient,
  input: { classId: string; assessmentId: string; execution: SottoProviderExecution }
) {
  return inspectFailedAssessmentReceipt(database, input, true);
}

async function inspectFailedAssessmentReceipt(
  database: Prisma.TransactionClient,
  input: { classId: string; assessmentId: string; execution: SottoProviderExecution },
  historical: boolean
) {
  input.execution.signal?.throwIfAborted();
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
      class: { include: { submission: true } },
      submission: { include: { answers: true, productiveEvidence: true } },
      sections: { include: { questions: true } },
    },
  });
  if (!assessment?.submission || !assessment.generationOperationId || !assessment.class.submission)
    throw new AssessmentFenceConflict();
  const record = await sottoJobOutbox(database).read(assessment.generationOperationId);
  if (!record) throw new AssessmentFenceConflict();
  const fence = historical
    ? (await readAssessmentArchive(database, assessment.generationOperationId)).fence
    : (await assessmentFenceStore(assessmentFenceBackend(database, input.classId)).read()).current;
  if (
    !fence ||
    fence.id !== assessment.generationOperationId ||
    fence.assessmentId !== assessment.id ||
    fence.status !== 'COMPLETED' ||
    assessment.status !== 'COMMITTED' ||
    (historical
      ? assessment.class.attempt < assessment.classAttempt
      : assessment.class.status !== 'FAILED' ||
        assessment.class.attempt !== assessment.classAttempt) ||
    fence.assessmentAttempt !== assessment.assessmentAttempt ||
    assessment.materialVersion !== (fence.materialVersion ?? 1) ||
    (!historical &&
      (await database.classAssessment.count({
        where: {
          classId: input.classId,
          classAttempt: assessment.classAttempt,
          assessmentAttempt: { gt: assessment.assessmentAttempt },
        },
      })) !== 0)
  )
    throw new AssessmentFenceConflict();
  const history = await readVerifiedHistoricalAssessmentGeneration(database, {
    id: record.job.id,
    fingerprint: record.fingerprint,
  });
  const original = assessmentWorkSchema.parse(record.job.payload).fence;
  if (!isDeepStrictEqual(fence, { ...original, status: 'COMPLETED' }))
    throw new AssessmentFenceConflict();
  const receipt = classReceiptSchema.parse(assessment.submission.receipt);
  const currentReceipt = classReceiptSchema.parse(assessment.class.submission.receipt);
  if (
    receipt.source !== 'ASSESSMENT' ||
    receipt.passed ||
    !isDeepStrictEqual(receipt, currentReceipt) ||
    assessment.class.submission.userId !== actor.userId ||
    assessment.class.submission.attempt !== assessment.classAttempt ||
    assessment.class.submission.passed !== false ||
    assessment.class.submission.overallScore !== receipt.overallScore
  )
    throw new AssessmentFenceConflict();
  const questions = assessment.sections.flatMap((section) => section.questions);
  const answers = assessment.submission.answers;
  if (
    answers.length !== questions.length ||
    answers.some((answer) => {
      const question = questions.find((item) => item.id === answer.questionId);
      return (
        !question ||
        !Array.isArray(question.options) ||
        !Number.isInteger(answer.selectedIndex) ||
        answer.selectedIndex < 0 ||
        answer.selectedIndex >= question.options.length ||
        answer.isCorrect !== (answer.selectedIndex === question.correctIndex)
      );
    })
  )
    throw new AssessmentFenceConflict();
  const choices = answers
    .map(({ questionId, selectedIndex }) => ({ itemId: questionId, selectedIndex }))
    .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  if (
    assessment.submission.requestDigest !==
    objectiveEvidenceHash({
      version: 1,
      classId: input.classId,
      assessmentId: assessment.id,
      userId: actor.userId,
      choices,
    })
  )
    throw new AssessmentFenceConflict();
  if (history.scoringPolicy !== 1) throw new AssessmentFenceConflict();
  const writing = await verifyFailedAssessmentWriting(database, input);
  const speaking = await verifyFailedAssessmentSpeaking(database, {
    ...input,
    material: history.material,
    generationFence: fence,
  });
  const evidence = [...writing, ...speaking];
  if (
    evidence.length !== assessment.submission.productiveEvidence.length ||
    assessment.submission.productiveEvidence.some(
      (item) => (item.writingResponseId === null) === (item.speakingRecordingId === null)
    ) ||
    new Set(evidence.map((item) => item.itemId)).size !== evidence.length ||
    new Set(evidence.map((item) => item.operationId)).size !== evidence.length
  )
    throw new AssessmentFenceConflict();
  const evaluation = evaluateRetainedAssessmentMaterial(
    history.material,
    { ...history, ...(fence.speakingPolicy ? { speakingPolicy: fence.speakingPolicy } : {}) },
    choices,
    evidence
  );
  if (
    !evaluation.complete ||
    evaluation.mastered ||
    !isDeepStrictEqual(assessmentEvaluationReceipt(history.material, evaluation), receipt)
  )
    throw new AssessmentFenceConflict();
  const finalActor = await input.execution.authorize(database);
  if (finalActor.userId !== actor.userId) throw new AssessmentFenceConflict();
  input.execution.signal?.throwIfAborted();
  return {
    assessmentId: assessment.id,
    assessmentAttempt: assessment.assessmentAttempt,
    classAttempt: assessment.classAttempt,
    submissionId: assessment.submission.id,
    requestDigest: assessment.submission.requestDigest,
    operation: { id: record.job.id, fingerprint: record.fingerprint },
    failedSkills: receipt.sections
      .filter((section) => !section.passed)
      .map((section) => section.skill),
  };
}
