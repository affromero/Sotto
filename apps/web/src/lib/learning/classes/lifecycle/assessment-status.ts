import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { createPrerequisiteTokenizer } from '@/lib/classes/help/content/prerequisite-token';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { LearningIncompleteError } from '../../session-evaluation';
import {
  assessmentFenceBackend,
  assessmentFenceStore,
  assessmentWorkSchema,
  AssessmentFenceConflict,
  assessmentRequestRevision,
} from './assessment-fence';
import { requirePendingAssessmentWork } from '../generation/assessment-work';
import { recoverAssessmentOutcome } from './assessment-outcome';
import { readPublicAssessment } from '../material/assessment-read';
import { captureAssessmentGenerationSource } from '../material/assessment-source';
import { requireAssessmentPracticeComplete } from '../practice/assessment-practice';
import { capturePriorAssessmentExposure } from '../history/assessment-prior-exposure';

/** Inspect owned work without returning private generation or grading material. */
export async function readAssessmentStatus(
  database: Prisma.TransactionClient,
  classId: string,
  execution: SottoProviderExecution
) {
  execution.signal?.throwIfAborted();
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment status requires a Serializable transaction');
  const actor = await execution.authorize(database);
  if (actor.userId !== execution.userId) throw new AssessmentFenceConflict();
  await database.$queryRaw`SELECT c.id FROM "CourseClass" c JOIN "Course" o ON o.id = c."courseId" WHERE c.id = ${classId} AND o."userId" = ${actor.userId} FOR UPDATE OF c`;
  const cls = await database.courseClass.findFirst({
    where: { id: classId, course: { userId: actor.userId } },
    select: { id: true, courseId: true, attempt: true, status: true },
  });
  if (!cls || !['AVAILABLE', 'IN_PROGRESS'].includes(cls.status))
    throw new AssessmentFenceConflict();
  const fence = (await assessmentFenceStore(assessmentFenceBackend(database, classId)).read())
    .current;
  if (!fence) {
    const assessmentAttempt =
      (await database.classAssessment.count({ where: { classId, classAttempt: cls.attempt } })) + 1;
    const priorAssessments = await capturePriorAssessmentExposure(database, {
      classId,
      courseId: cls.courseId,
      userId: actor.userId,
      classAttempt: cls.attempt,
      assessmentAttempt,
    });
    if (priorAssessments.length) throw new AssessmentFenceConflict();
    const source = await captureAssessmentGenerationSource(database, execution, {
      classId,
      classAttempt: cls.attempt,
    });
    try {
      await requireAssessmentPracticeComplete(database, {
        classId,
        classAttempt: cls.attempt,
        userId: actor.userId,
      });
    } catch (error) {
      if (error instanceof LearningIncompleteError)
        return { status: 'PRACTICE_REQUIRED' as const, classAttempt: cls.attempt };
      throw error;
    }
    const tokenizer = createPrerequisiteTokenizer(classId, actor.userId);
    try {
      return {
        status: 'AVAILABLE' as const,
        classAttempt: cls.attempt,
        revision: tokenizer.assessment(assessmentRequestRevision({ ...source, assessmentAttempt })),
      };
    } finally {
      tokenizer.dispose();
    }
  }
  const ownership = await capturePrerequisiteOwnership(
    database,
    classId,
    cls.courseId,
    actor.userId
  );
  if (
    fence.classId !== classId ||
    fence.courseId !== cls.courseId ||
    fence.userId !== actor.userId ||
    fence.classAttempt !== cls.attempt ||
    !isDeepStrictEqual(fence.ownership, ownership)
  )
    throw new AssessmentFenceConflict();
  const record = await sottoJobOutbox(database).read(fence.id);
  if (
    !record ||
    record.job.id !== fence.id ||
    record.job.handler !== 'interactions' ||
    record.job.version !== 6 ||
    !isDeepStrictEqual(record.job.scopes, ownership.scopes) ||
    !isDeepStrictEqual(assessmentWorkSchema.parse(record.job.payload).fence, {
      ...fence,
      status: 'QUEUED',
    })
  )
    throw new AssessmentFenceConflict();
  const assessment = await database.classAssessment.findUnique({
    where: { id: fence.assessmentId },
  });
  if (
    !assessment ||
    assessment.classId !== classId ||
    assessment.courseId !== cls.courseId ||
    assessment.userId !== actor.userId ||
    assessment.classAttempt !== cls.attempt ||
    assessment.assessmentAttempt !== fence.assessmentAttempt ||
    assessment.materialVersion !== (fence.materialVersion ?? 1) ||
    assessment.generationOperationId !== fence.id
  )
    throw new AssessmentFenceConflict();
  const identity = { id: fence.id, fingerprint: record.fingerprint };
  const tokenizer = createPrerequisiteTokenizer(classId, actor.userId);
  let revision: string;
  try {
    revision = tokenizer.assessment(assessmentRequestRevision(fence));
  } finally {
    tokenizer.dispose();
  }
  if (fence.status === 'UNRESOLVED') {
    if (record.complete || assessment.status !== 'UNRESOLVED') throw new AssessmentFenceConflict();
    return { status: 'UNRESOLVED' as const, classAttempt: cls.attempt };
  }
  if (fence.status === 'QUEUED' || fence.status === 'RUNNING') {
    if (record.complete || assessment.status !== 'GENERATING' || assessment.sealedAt !== null)
      throw new AssessmentFenceConflict();
    const grant = await learningPreparationGrant(database, fence, 'assessment').read(fence.grant);
    const blocking = await sottoJobExecutions(database).blockingStatus(
      identity.id,
      identity.fingerprint
    );
    if (grant.status !== 'active' || grant.grant.expiresAt <= Date.now())
      return blocking === 'active'
        ? { status: 'PENDING' as const, classAttempt: cls.attempt, revision }
        : { status: 'UNRESOLVED' as const, classAttempt: cls.attempt };
    await requirePendingAssessmentWork(database, identity, execution, fence.status);
    return blocking && blocking !== 'active'
      ? { status: 'UNRESOLVED' as const, classAttempt: cls.attempt }
      : { status: 'PENDING' as const, classAttempt: cls.attempt, revision };
  }
  if (fence.status !== 'COMPLETED' || assessment.status !== 'READY')
    throw new AssessmentFenceConflict();
  const blocking = await sottoJobExecutions(database).blockingStatus(
    identity.id,
    identity.fingerprint
  );
  if (blocking)
    return blocking === 'active'
      ? { status: 'PENDING' as const, classAttempt: cls.attempt, revision }
      : { status: 'UNRESOLVED' as const, classAttempt: cls.attempt };
  if (!(await recoverAssessmentOutcome(database, identity))) throw new AssessmentFenceConflict();
  try {
    await readPublicAssessment(database, { classId, assessmentId: assessment.id, execution });
  } catch (error) {
    if (error instanceof LearningIncompleteError)
      return { status: 'PRACTICE_REQUIRED' as const, classAttempt: cls.attempt };
    throw error;
  }
  return {
    status: 'READY' as const,
    classAttempt: cls.attempt,
    assessmentId: assessment.id,
    revision,
  };
}
