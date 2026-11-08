import { writingFeedbackSchema } from '@sotto/shared';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { objectiveEvidenceHash } from '@/lib/learning-map/evidence/protocol';
import { writingExecutionSchema } from '@/lib/learning/writing/writing-execution';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  lockPracticeGrant,
  readLockedPracticeOutbox,
} from '../practice/assessment-practice-execution';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { assessmentWritingInputDigest } from './assessment-writing-identity';
import { captureAssessmentWritingTask } from './assessment-writing-read';
import { readAssessmentWritingRecovery } from './assessment-writing-recovery';
import {
  assessmentWritingGradeDigest,
  assessmentWritingReceiptSchema,
} from './assessment-writing-receipt';

/** Capture internal grading evidence in the same Serializable transaction as submission. */
export async function captureAssessmentWritingEvidence(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    assessmentId: string;
    promptId: string;
    execution: SottoProviderExecution;
  }
) {
  const isolation = await database.$queryRaw<
    { isolation: string }[]
  >`SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment evidence requires a Serializable transaction.');
  const recovery = await readAssessmentWritingRecovery(database, input);
  if (!recovery || recovery.status !== 'COMPLETED') throw new AssessmentFenceConflict();
  await database.$queryRaw`SELECT id FROM "WritingResponse" WHERE id = ${recovery.responseId} FOR UPDATE`;
  const response = await database.writingResponse.findUniqueOrThrow({
    where: { id: recovery.responseId },
  });
  const grade = writingFeedbackSchema.parse(response);
  if (!isDeepStrictEqual(response.corrections, grade.corrections))
    throw new AssessmentFenceConflict();
  const operation = writingExecutionSchema.parse(response.gradingState);
  if (!operation.assessment || operation.status !== 'COMPLETED')
    throw new AssessmentFenceConflict();
  const captured = await captureAssessmentWritingTask(database, input);
  const record = await readLockedPracticeOutbox(database, operation.id);
  if (
    !record ||
    !record.complete ||
    record.fingerprint !== operation.fingerprint ||
    !(await lockPracticeGrant(database, operation.id, 'writing'))
  )
    throw new AssessmentFenceConflict();
  const claim = await database.sidedoorState.findUnique({
    where: { id: `${SIDEDOOR_STATE_ID}:assessment-writing-launch:${operation.id}` },
  });
  const launch = z
    .object({ operationId: z.uuid(), fingerprint: z.string(), launchId: z.uuid() })
    .strict()
    .safeParse(claim?.state);
  if (
    !launch.success ||
    launch.data.operationId !== operation.id ||
    launch.data.fingerprint !== operation.fingerprint
  )
    throw new AssessmentFenceConflict();
  const page = await sottoJobSnapshot(database).read(operation.id, operation.fingerprint, 0);
  if (page.pages !== 1 || page.next !== null || page.items.length !== 1)
    throw new AssessmentFenceConflict();
  const receipt = assessmentWritingReceiptSchema.parse(page.items[0]);
  if (
    receipt.operationId !== operation.id ||
    receipt.fingerprint !== operation.fingerprint ||
    receipt.responseId !== response.id ||
    receipt.assessmentId !== captured.assessmentId ||
    receipt.classId !== captured.classId ||
    receipt.courseId !== captured.courseId ||
    receipt.userId !== captured.userId ||
    receipt.classAttempt !== captured.classAttempt ||
    receipt.assessmentAttempt !== captured.assessmentAttempt ||
    receipt.sectionId !== captured.sectionId ||
    receipt.promptId !== captured.prompt.id ||
    receipt.materialDigest !== captured.materialDigest ||
    receipt.materialDigest !== operation.assessment.materialDigest ||
    receipt.inputDigest !== operation.assessment.inputDigest ||
    receipt.inputDigest !==
      assessmentWritingInputDigest(
        captured,
        response.text,
        operation.selection,
        receipt.requestDigest
      ) ||
    receipt.textDigest !== objectiveEvidenceHash({ text: response.text }) ||
    receipt.score !== grade.overallScore ||
    receipt.gradeDigest !==
      assessmentWritingGradeDigest({
        overallScore: grade.overallScore,
        corrections: grade.corrections,
        feedback: grade.feedback,
        objectiveEvidence: response.objectiveEvidence,
      })
  )
    throw new AssessmentFenceConflict();
  return {
    evidence: {
      assessmentId: captured.assessmentId,
      userId: captured.userId,
      classAttempt: captured.classAttempt,
      assessmentAttempt: captured.assessmentAttempt,
      itemId: captured.prompt.id,
      sectionId: captured.sectionId,
      operationId: operation.id,
      status: 'SCORED' as const,
      materialDigest: captured.materialDigest,
      score: grade.overallScore,
    },
    responseId: response.id,
    operationFingerprint: operation.fingerprint,
    inputDigest: operation.assessment.inputDigest,
    receipt,
  };
}
