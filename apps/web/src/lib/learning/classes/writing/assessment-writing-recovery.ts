import { isDeepStrictEqual } from 'node:util';
import { writingFeedbackSchema } from '@sotto/shared';
import { ZodError } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { writingExecutionSchema } from '@/lib/learning/writing/writing-execution';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { objectiveEvidenceHash } from '@/lib/learning-map/evidence/protocol';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { hasSettledSottoExecution } from '@/lib/sidedoor/jobs/core/job-settlement-proof';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import {
  assessmentWritingGradeDigest,
  assessmentWritingReceiptSchema,
} from './assessment-writing-receipt';

const snapshotIntegrityFailures = new Set([
  'Snapshot is missing',
  'Snapshot binding mismatch',
  'Snapshot erasure cursor is invalid',
  'Snapshot is being erased',
  'Snapshot is not sealed',
  'Sealed snapshot page is missing',
  'Snapshot page exceeds one MiB',
  'Snapshot page identity mismatch',
]);

type WritingRecoveryInput = {
  classId: string;
  assessmentId: string;
  promptId: string;
  execution: SottoProviderExecution;
};

/** Inspect retained work without admitting a new provider request or returning a score. */
export function readAssessmentWritingRecovery(
  database: Prisma.TransactionClient,
  input: WritingRecoveryInput
) {
  return inspectAssessmentWritingRecovery(database, input, false);
}

/** Complete only an already verified, drained queued operation; never dispatch a provider. */
export function settleCompletedAssessmentWriting(
  database: Prisma.TransactionClient,
  input: WritingRecoveryInput
) {
  return inspectAssessmentWritingRecovery(database, input, true);
}

async function inspectAssessmentWritingRecovery(
  database: Prisma.TransactionClient,
  input: WritingRecoveryInput,
  settlePending: boolean
) {
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
  });
  if (!assessment) throw new AssessmentFenceConflict();
  const rows = await database.writingResponse.findMany({
    where: { promptId: input.promptId, assessmentSection: { assessmentId: assessment.id } },
    take: 2,
  });
  if (!rows.length) return null;
  if (rows.length !== 1) throw new AssessmentFenceConflict();
  const response = rows[0]!;
  const parsed = writingExecutionSchema.safeParse(response.gradingState);
  if (!parsed.success || !parsed.data.assessment || response.userId !== actor.userId)
    throw new AssessmentFenceConflict();
  const operation = parsed.data;
  const binding = operation.assessment!;
  const ownership = await capturePrerequisiteOwnership(
    database,
    input.classId,
    assessment.courseId,
    actor.userId
  );
  const record = await sottoJobOutbox(database).read(operation.id);
  if (
    operation.userId !== actor.userId ||
    operation.courseId !== assessment.courseId ||
    operation.instanceId !== ownership.instanceId ||
    operation.grant.id !== operation.id ||
    binding.assessmentId !== assessment.id ||
    binding.classId !== input.classId ||
    binding.classAttempt !== assessment.classAttempt ||
    binding.assessmentAttempt !== assessment.assessmentAttempt ||
    binding.sectionId !== response.assessmentSectionId ||
    response.attempt !== binding.assessmentAttempt ||
    response.sectionId !== null ||
    response.practiceSessionId !== null ||
    response.examSectionId !== null ||
    !record ||
    record.job.id !== operation.id ||
    record.fingerprint !== operation.fingerprint ||
    record.job.handler !== 'learning-writing' ||
    ![2, 3].includes(record.job.version) ||
    !isDeepStrictEqual(record.job.scopes, ownership.scopes) ||
    !isDeepStrictEqual(record.job.payload, {
      responseId: response.id,
      text: response.text,
      promptId: input.promptId,
      attempt: response.attempt,
      selection: operation.selection,
      assessment: binding,
    })
  )
    throw new AssessmentFenceConflict();
  const grant = await learningPreparationGrant(database, operation, 'writing').read(
    operation.grant
  );
  const blocked = await sottoJobExecutions(database).blockingStatus(
    operation.id,
    operation.fingerprint
  );
  let status = operation.status;
  if (blocked === 'cleanup-unconfirmed') status = 'UNRESOLVED';
  else if (blocked === 'active')
    status = operation.status === 'UNRESOLVED' ? 'UNRESOLVED' : 'RUNNING';
  else if (operation.status === 'RUNNING' && operation.expiresAt <= Date.now())
    status = 'UNRESOLVED';
  else if (operation.status === 'COMPLETED') {
    const settled = await hasSettledSottoExecution(database, operation);
    if (
      (!record.complete && (!settlePending || record.job.version !== 3)) ||
      grant.status !== 'completed' ||
      grant.attempts.some((attempt) => ['admitted', 'unknown'].includes(attempt.outcome)) ||
      !settled
    )
      status = 'UNRESOLVED';
    if (status === 'COMPLETED') {
      const grade = writingFeedbackSchema.safeParse(response);
      const page = await sottoJobSnapshot(database)
        .read(operation.id, operation.fingerprint, 0)
        .catch((error: unknown) => {
          if (
            error instanceof ZodError ||
            (error instanceof Error && snapshotIntegrityFailures.has(error.message))
          )
            return null;
          throw error;
        });
      const receipt =
        page && page.pages === 1 && page.next === null && page.items.length === 1
          ? assessmentWritingReceiptSchema.safeParse(page.items[0])
          : null;
      if (
        !grade.success ||
        !receipt?.success ||
        !isDeepStrictEqual(response.corrections, grade.data.corrections) ||
        receipt.data.operationId !== operation.id ||
        receipt.data.fingerprint !== operation.fingerprint ||
        receipt.data.assessmentId !== assessment.id ||
        receipt.data.classId !== input.classId ||
        receipt.data.courseId !== assessment.courseId ||
        receipt.data.userId !== actor.userId ||
        receipt.data.classAttempt !== binding.classAttempt ||
        receipt.data.assessmentAttempt !== binding.assessmentAttempt ||
        receipt.data.sectionId !== binding.sectionId ||
        receipt.data.promptId !== input.promptId ||
        receipt.data.responseId !== response.id ||
        receipt.data.materialDigest !== binding.materialDigest ||
        receipt.data.inputDigest !== binding.inputDigest ||
        receipt.data.textDigest !== objectiveEvidenceHash({ text: response.text }) ||
        receipt.data.score !== grade.data.overallScore ||
        receipt.data.gradeDigest !==
          assessmentWritingGradeDigest({
            overallScore: grade.data.overallScore,
            corrections: grade.data.corrections,
            feedback: grade.data.feedback,
            objectiveEvidence: response.objectiveEvidence,
          })
      )
        status = 'UNRESOLVED';
    }
  } else if (operation.status === 'FAILED') {
    const settled =
      grant.attempts.length === 0 || (await hasSettledSottoExecution(database, operation));
    if (
      !record.complete ||
      grant.status !== 'revoked' ||
      grant.attempts.some((attempt) =>
        ['admitted', 'unknown', 'succeeded'].includes(attempt.outcome)
      ) ||
      !settled
    )
      status = 'UNRESOLVED';
  }
  if (settlePending && status === 'COMPLETED' && !record.complete) {
    const finalActor = await input.execution.authorize(database);
    if (finalActor.userId !== actor.userId) throw new AssessmentFenceConflict();
    input.execution.signal?.throwIfAborted();
    if (!(await sottoJobOutbox(database).complete(operation.id, operation.fingerprint)))
      throw new AssessmentFenceConflict();
  }
  return { responseId: response.id, operationId: operation.id, status, text: response.text };
}
