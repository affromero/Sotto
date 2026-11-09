import type { Prisma } from '@/generated/prisma/client';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import {
  readAssessmentSpeakingStatus,
  verifyCompletedAssessmentSpeaking,
} from './lifecycle/assessment-speaking-recovery';

/** Capture only a verified completed recording for the owned assessment submission. */
export async function captureAssessmentSpeakingEvidence(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    assessmentId: string;
    promptId: string;
    execution: SottoProviderExecution;
  }
) {
  const actor = await input.execution.authorize(database);
  if (actor.userId !== input.execution.userId) throw new AssessmentFenceConflict();
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${input.assessmentId} FOR UPDATE`;
  if ((await readAssessmentSpeakingStatus(database, input)).status !== 'COMPLETED')
    throw new AssessmentFenceConflict();
  const recordings = await database.speakingRecording.findMany({
    where: {
      promptId: input.promptId,
      userId: actor.userId,
      status: { not: 'FAILED' },
      assessmentSection: { assessmentId: input.assessmentId },
    },
    take: 2,
  });
  if (recordings.length !== 1 || !recordings[0]?.gradingOperationId)
    throw new AssessmentFenceConflict();
  const operationId = recordings[0].gradingOperationId;
  const record = await sottoJobOutbox(database).read(operationId);
  if (!record?.complete) throw new AssessmentFenceConflict();
  const verified = await verifyCompletedAssessmentSpeaking(
    database,
    { operationId, fingerprint: record.fingerprint },
    input.execution.signal
  );
  if (
    !verified ||
    !verified.record.complete ||
    verified.recording.id !== recordings[0].id ||
    verified.payload.assessment.classId !== input.classId ||
    verified.payload.assessment.assessmentId !== input.assessmentId ||
    verified.payload.assessment.promptId !== input.promptId ||
    verified.payload.assessment.userId !== actor.userId
  )
    throw new AssessmentFenceConflict();
  const finalActor = await input.execution.authorize(database);
  if (finalActor.userId !== actor.userId) throw new AssessmentFenceConflict();
  input.execution.signal?.throwIfAborted();
  const binding = verified.payload.assessment;
  return {
    evidence: {
      assessmentId: binding.assessmentId,
      userId: binding.userId,
      classAttempt: binding.classAttempt,
      assessmentAttempt: binding.assessmentAttempt,
      itemId: binding.promptId,
      sectionId: binding.sectionId,
      operationId,
      status: 'SCORED' as const,
      materialDigest: binding.materialDigest,
      score: verified.receipt.score,
    },
    recordingId: verified.recording.id,
    operationFingerprint: verified.record.fingerprint,
    inputDigest: verified.receipt.inputDigest,
    receipt: verified.receipt,
  };
}
