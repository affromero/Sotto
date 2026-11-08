import { classReceiptSchema } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { assessmentWorkSchema, AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { exposedAssessmentTasks } from '../material/assessment-material';

const MAX_PRIOR_ASSESSMENTS = 100;

/** Read previously exposed tasks under the owned class lock. */
export async function capturePriorAssessmentExposure(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    courseId: string;
    userId: string;
    classAttempt: number;
    assessmentAttempt: number;
  }
) {
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment exposure requires a Serializable transaction.');
  await database.$queryRaw`SELECT c.id FROM "CourseClass" c JOIN "Course" o ON o.id = c."courseId" WHERE c.id = ${input.classId} AND o.id = ${input.courseId} AND o."userId" = ${input.userId} FOR UPDATE OF c`;
  const owned = await database.courseClass.findFirst({
    where: {
      id: input.classId,
      courseId: input.courseId,
      course: { userId: input.userId },
      attempt: input.classAttempt,
    },
    select: { id: true },
  });
  if (!owned) throw new AssessmentFenceConflict();
  if (
    !Number.isSafeInteger(input.assessmentAttempt) ||
    input.assessmentAttempt < 1 ||
    input.assessmentAttempt > 100
  )
    throw new AssessmentFenceConflict();
  const prior = await database.classAssessment.findMany({
    where: {
      classId: input.classId,
      OR: [
        { classAttempt: { lt: input.classAttempt } },
        { classAttempt: input.classAttempt, assessmentAttempt: { lt: input.assessmentAttempt } },
      ],
    },
    include: { submission: true },
    orderBy: [{ classAttempt: 'asc' }, { assessmentAttempt: 'asc' }],
    take: MAX_PRIOR_ASSESSMENTS + 1,
  });
  if (prior.length > MAX_PRIOR_ASSESSMENTS) throw new AssessmentFenceConflict();
  if (
    prior.filter((assessment) => assessment.classAttempt === input.classAttempt).length !==
    input.assessmentAttempt - 1
  )
    throw new AssessmentFenceConflict();
  const exposures = [];
  let previousAttempt = 0;
  let previousAssessment = 0;
  for (const assessment of prior) {
    if (assessment.classAttempt !== previousAttempt) {
      previousAttempt = assessment.classAttempt;
      previousAssessment = 0;
    }
    previousAssessment += 1;
    if (
      assessment.assessmentAttempt !== previousAssessment ||
      assessment.classId !== input.classId ||
      assessment.courseId !== input.courseId ||
      assessment.userId !== input.userId ||
      assessment.status !== 'COMMITTED' ||
      !assessment.submission ||
      !assessment.generationOperationId
    )
      throw new AssessmentFenceConflict();
    const receipt = classReceiptSchema.parse(assessment.submission.receipt);
    if (receipt.source !== 'ASSESSMENT' || receipt.passed) throw new AssessmentFenceConflict();
    const record = await sottoJobOutbox(database).read(assessment.generationOperationId);
    if (!record || record.job.handler !== 'interactions' || record.job.version !== 6)
      throw new AssessmentFenceConflict();
    const { fence } = assessmentWorkSchema.parse(record.job.payload);
    if (
      fence.id !== assessment.generationOperationId ||
      fence.classId !== input.classId ||
      fence.courseId !== input.courseId ||
      fence.userId !== input.userId ||
      fence.classAttempt !== assessment.classAttempt ||
      fence.assessmentId !== assessment.id ||
      fence.assessmentAttempt !== assessment.assessmentAttempt ||
      assessment.materialVersion !== (fence.materialVersion ?? 1)
    )
      throw new AssessmentFenceConflict();
    const { readVerifiedHistoricalAssessmentGeneration } =
      await import('../lifecycle/assessment-outcome');
    const history = await readVerifiedHistoricalAssessmentGeneration(database, {
      id: record.job.id,
      fingerprint: record.fingerprint,
    });
    if (!history.reviewSource) throw new AssessmentFenceConflict();
    const { verifyHistoricalFailedAssessmentReceipt } = await import('./assessment-failed-receipt');
    const verified = await verifyHistoricalFailedAssessmentReceipt(database, {
      classId: input.classId,
      assessmentId: assessment.id,
      execution: {
        userId: input.userId,
        authorize: async (tx) => {
          const owned = await tx.courseClass.findFirst({
            where: {
              id: input.classId,
              courseId: input.courseId,
              course: { userId: input.userId },
            },
            select: { id: true },
          });
          if (!owned) throw new AssessmentFenceConflict();
          return { userId: input.userId };
        },
      },
    });
    if (
      verified.submissionId !== assessment.submission.id ||
      verified.requestDigest !== assessment.submission.requestDigest ||
      verified.operation.id !== record.job.id ||
      verified.operation.fingerprint !== record.fingerprint
    )
      throw new AssessmentFenceConflict();
    exposures.push({
      assessmentId: assessment.id,
      classAttempt: assessment.classAttempt,
      assessmentAttempt: assessment.assessmentAttempt,
      submissionId: verified.submissionId,
      requestDigest: verified.requestDigest,
      operationId: record.job.id,
      fingerprint: record.fingerprint,
      tasks: exposedAssessmentTasks(history.material),
    });
  }
  return exposures;
}
