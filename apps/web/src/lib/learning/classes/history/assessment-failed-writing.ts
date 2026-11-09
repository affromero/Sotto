import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { readSkillRequirements } from '@/lib/learning/skill-requirements';
import { writingExecutionSchema } from '@/lib/learning/writing/writing-execution';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { assessmentWritingInputDigest } from '../writing/assessment-writing-identity';
import { assessmentWritingReceiptSchema } from '../writing/assessment-writing-receipt';
import { readAssessmentWritingRecovery } from '../writing/assessment-writing-recovery';
import { assessmentWritingTask } from '../writing/assessment-writing-task';
import {
  lockPracticeGrant,
  readLockedPracticeOutbox,
} from '../practice/assessment-practice-execution';

/** Verify retained writing after the caller authenticates the assessment generation proof. */
export async function verifyFailedAssessmentWriting(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    assessmentId: string;
    execution: SottoProviderExecution;
  }
) {
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment evidence requires a Serializable transaction.');
  input.execution.signal?.throwIfAborted();
  const initialActor = await input.execution.authorize(database);
  if (initialActor.userId !== input.execution.userId) throw new AssessmentFenceConflict();
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${input.assessmentId} FOR UPDATE`;
  const assessment = await database.classAssessment.findUniqueOrThrow({
    where: { id: input.assessmentId },
    include: {
      sections: { include: { writingPrompts: true } },
      submission: { include: { productiveEvidence: true } },
    },
  });
  const requirements = readSkillRequirements(assessment.requirements);
  if (
    assessment.classId !== input.classId ||
    assessment.userId !== input.execution.userId ||
    assessment.status !== 'COMMITTED' ||
    !assessment.submission ||
    !assessment.reviewedMaterialDigest ||
    !requirements
  )
    throw new AssessmentFenceConflict();
  const prompts = assessment.sections.flatMap((section) =>
    section.writingPrompts.map((prompt) => ({ section, prompt }))
  );
  const evidence = assessment.submission.productiveEvidence.filter(
    (item) => item.writingResponseId !== null
  );
  const writing = requirements.skills.WRITING;
  if (
    prompts.length !== evidence.length ||
    prompts.length !== (writing.state === 'REQUIRED' ? writing.expectedCount : 0) ||
    new Set(prompts.map(({ prompt }) => prompt.id)).size !== prompts.length
  )
    throw new AssessmentFenceConflict();
  const verified = [];
  for (const { section, prompt } of prompts) {
    const saved = evidence.find((item) => item.promptId === prompt.id);
    if (
      !saved ||
      !saved.writingResponseId ||
      saved.speakingRecordingId !== null ||
      section.skill !== 'WRITING' ||
      saved.sectionId !== section.id ||
      saved.materialDigest !== assessment.reviewedMaterialDigest ||
      !prompt.assessmentRubric
    )
      throw new AssessmentFenceConflict();
    await database.$queryRaw`SELECT id FROM "WritingResponse" WHERE id = ${saved.writingResponseId} FOR UPDATE`;
    const record = await readLockedPracticeOutbox(database, saved.operationId);
    if (
      !record ||
      !record.complete ||
      record.fingerprint !== saved.operationFingerprint ||
      !(await lockPracticeGrant(database, saved.operationId, 'writing'))
    )
      throw new AssessmentFenceConflict();
    const recovery = await readAssessmentWritingRecovery(database, {
      ...input,
      promptId: prompt.id,
    });
    if (
      !recovery ||
      recovery.status !== 'COMPLETED' ||
      recovery.responseId !== saved.writingResponseId ||
      recovery.operationId !== saved.operationId
    )
      throw new AssessmentFenceConflict();
    const response = await database.writingResponse.findUniqueOrThrow({
      where: { id: saved.writingResponseId },
    });
    const operation = writingExecutionSchema.parse(response.gradingState);
    const claim = await database.sidedoorState.findUnique({
      where: { id: `${SIDEDOOR_STATE_ID}:assessment-writing-launch:${saved.operationId}` },
    });
    const launch = z
      .object({ operationId: z.uuid(), fingerprint: z.string(), launchId: z.uuid() })
      .strict()
      .safeParse(claim?.state);
    if (
      !launch.success ||
      launch.data.operationId !== saved.operationId ||
      launch.data.fingerprint !== saved.operationFingerprint
    )
      throw new AssessmentFenceConflict();
    const page = await sottoJobSnapshot(database).read(
      saved.operationId,
      saved.operationFingerprint,
      0
    );
    if (page.pages !== 1 || page.next !== null || page.items.length !== 1)
      throw new AssessmentFenceConflict();
    const receipt = assessmentWritingReceiptSchema.parse(page.items[0]);
    const captured = {
      assessmentId: assessment.id,
      classId: assessment.classId,
      courseId: assessment.courseId,
      userId: assessment.userId,
      classAttempt: assessment.classAttempt,
      assessmentAttempt: assessment.assessmentAttempt,
      materialDigest: assessment.reviewedMaterialDigest,
      sectionId: section.id,
      prompt: assessmentWritingTask(prompt),
      requirements,
    };
    if (
      !isDeepStrictEqual(saved.snapshot, receipt) ||
      receipt.fingerprint !== saved.operationFingerprint ||
      receipt.inputDigest !== saved.inputDigest ||
      receipt.materialDigest !== saved.materialDigest ||
      receipt.score !== saved.score ||
      receipt.inputDigest !==
        assessmentWritingInputDigest(
          captured,
          response.text,
          operation.selection,
          receipt.requestDigest
        )
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
  const actor = await input.execution.authorize(database);
  if (actor.userId !== assessment.userId) throw new AssessmentFenceConflict();
  input.execution.signal?.throwIfAborted();
  return verified;
}
