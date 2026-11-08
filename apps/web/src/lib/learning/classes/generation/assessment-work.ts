import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { captureAssessmentGenerationSource } from '../material/assessment-source';
import { assessmentProviderBudget } from './assessment-admission';
import {
  assertAssessmentFenceSource,
  assessmentFenceBackend,
  assessmentFenceStore,
  assessmentWorkSchema,
  AssessmentFenceConflict,
} from '../lifecycle/assessment-fence';

type Identity = { id: string; fingerprint: string };

/** Keep an admitted attempt settleable after source invalidation or grant revocation. */
export async function requireAssessmentSettlementWork(
  database: Prisma.TransactionClient,
  identity: Identity
) {
  const record = await sottoJobOutbox(database).read(identity.id);
  if (
    !record ||
    record.complete ||
    record.fingerprint !== identity.fingerprint ||
    record.job.handler !== 'interactions' ||
    record.job.version !== 6
  )
    throw new AssessmentFenceConflict();
  const { fence } = assessmentWorkSchema.parse(record.job.payload);
  const current = (
    await assessmentFenceStore(assessmentFenceBackend(database, fence.classId)).read()
  ).current;
  if (
    !current ||
    fence.id !== identity.id ||
    fence.status !== 'QUEUED' ||
    !['RUNNING', 'UNRESOLVED'].includes(current.status) ||
    !isDeepStrictEqual({ ...current, status: 'QUEUED' }, fence) ||
    !isDeepStrictEqual(record.job.scopes, fence.ownership.scopes)
  )
    throw new AssessmentFenceConflict();
  const assessment = await database.classAssessment.findUnique({
    where: { id: current.assessmentId },
  });
  if (
    !assessment ||
    assessment.classId !== current.classId ||
    assessment.courseId !== current.courseId ||
    assessment.userId !== current.userId ||
    assessment.classAttempt !== current.classAttempt ||
    assessment.assessmentAttempt !== current.assessmentAttempt ||
    assessment.materialVersion !== (current.materialVersion ?? 1) ||
    assessment.generationOperationId !== current.id
  )
    throw new AssessmentFenceConflict();
  return { record, current };
}

/** Verify the durable job, current fence, stored assessment and source before work. */
export async function requirePendingAssessmentWork(
  database: Prisma.TransactionClient,
  identity: Identity,
  execution: SottoProviderExecution,
  status: 'QUEUED' | 'RUNNING'
) {
  const record = await sottoJobOutbox(database).read(identity.id);
  if (
    !record ||
    record.complete ||
    record.fingerprint !== identity.fingerprint ||
    record.job.handler !== 'interactions' ||
    record.job.version !== 6
  )
    throw new AssessmentFenceConflict();
  const { fence } = assessmentWorkSchema.parse(record.job.payload);
  const current = (
    await assessmentFenceStore(assessmentFenceBackend(database, fence.classId)).read()
  ).current;
  if (
    !current ||
    fence.id !== identity.id ||
    fence.status !== 'QUEUED' ||
    current.status !== status ||
    !isDeepStrictEqual({ ...current, status: 'QUEUED' }, fence) ||
    !isDeepStrictEqual(record.job.scopes, fence.ownership.scopes)
  )
    throw new AssessmentFenceConflict();
  const source = await captureAssessmentGenerationSource(database, execution, {
    classId: current.classId,
    classAttempt: current.classAttempt,
  });
  assertAssessmentFenceSource(current, source);
  const assessment = await database.classAssessment.findUnique({
    where: { id: current.assessmentId },
    include: { sections: true },
  });
  const skills = Object.entries(current.requirements.skills)
    .filter(([, requirement]) => requirement.state === 'REQUIRED')
    .map(([skill]) => skill);
  if (
    !assessment ||
    assessment.classId !== current.classId ||
    assessment.courseId !== current.courseId ||
    assessment.userId !== current.userId ||
    assessment.classAttempt !== current.classAttempt ||
    assessment.assessmentAttempt !== current.assessmentAttempt ||
    assessment.materialVersion !== (current.materialVersion ?? 1) ||
    assessment.generationOperationId !== current.id ||
    assessment.status !== 'GENERATING' ||
    assessment.sealedAt !== null ||
    assessment.formativeRevision !== current.formativeRevision ||
    assessment.teachingKind !== current.teachingReceipt.kind ||
    assessment.teachingReceiptId !== current.teachingReceipt.receiptId ||
    !isDeepStrictEqual(assessment.requirements, current.requirements) ||
    assessment.sections.length !== skills.length ||
    assessment.sections.some(
      (section) =>
        !skills.includes(section.skill) ||
        section.passThreshold !== current.thresholds[section.skill]
    )
  )
    throw new AssessmentFenceConflict();
  const grant = learningPreparationGrant(database, current, 'assessment');
  await grant.validate(current.grant);
  if (
    (await grant.read(current.grant)).grant.maxRequests !== assessmentProviderBudget(skills.length)
  )
    throw new AssessmentFenceConflict();
  return { record, current, source };
}

/** The provider parent attempt and running fence commit before dispatch. */
export async function startAssessmentWork(
  database: Prisma.TransactionClient,
  identity: Identity,
  execution: SottoProviderExecution
) {
  const { record, current } = await requirePendingAssessmentWork(
    database,
    identity,
    execution,
    'QUEUED'
  );
  const touched =
    await database.$executeRaw`UPDATE "ClassAssessment" SET "updatedAt" = "updatedAt" WHERE id = ${current.assessmentId}`;
  if (touched !== 1) throw new AssessmentFenceConflict();
  const parent = {
    id: record.job.id,
    fingerprint: createHash('sha256').update(JSON.stringify(record.job.payload)).digest('hex'),
  };
  const admitted = await learningPreparationGrant(database, current, 'assessment').admit(
    current.grant,
    parent
  );
  if (!admitted.dispatch) throw new AssessmentFenceConflict();
  await assessmentFenceStore(assessmentFenceBackend(database, current.classId)).transact(
    (state) => {
      if (!isDeepStrictEqual(state.current, current)) throw new AssessmentFenceConflict();
      state.current = { ...current, status: 'RUNNING' };
    }
  );
}

/** Recheck provider state inside the execution journal's admission transaction. */
export async function validateAssessmentExecutionState(
  database: Prisma.TransactionClient,
  identity: Identity,
  execution: SottoProviderExecution
) {
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment execution admission requires a Serializable transaction');
  const record = await sottoJobOutbox(database).read(identity.id);
  if (!record || record.fingerprint !== identity.fingerprint || record.complete)
    throw new AssessmentFenceConflict();
  const { fence } = assessmentWorkSchema.parse(record.job.payload);
  const current = (
    await assessmentFenceStore(assessmentFenceBackend(database, fence.classId)).read()
  ).current;
  if (!current || !['QUEUED', 'RUNNING'].includes(current.status))
    throw new AssessmentFenceConflict();
  const status = current.status === 'QUEUED' ? 'QUEUED' : 'RUNNING';
  const pending = await requirePendingAssessmentWork(database, identity, execution, status);
  // Journal.begin runs after this callback in the same transaction. Touching
  // the parent lets a stale failure transaction detect a newly begun executor.
  const touched =
    await database.$executeRaw`UPDATE "ClassAssessment" SET "updatedAt" = "updatedAt" WHERE id = ${pending.current.assessmentId}`;
  if (touched !== 1) throw new AssessmentFenceConflict();
  const grant = await learningPreparationGrant(database, pending.current, 'assessment').read(
    pending.current.grant
  );
  const parentFingerprint = createHash('sha256')
    .update(JSON.stringify(record.job.payload))
    .digest('hex');
  const parent = grant.attempts.find((attempt) => attempt.id === identity.id);
  if (
    (status === 'QUEUED' && (parent || grant.attempts.length !== 0)) ||
    (status === 'RUNNING' &&
      (!parent || parent.fingerprint !== parentFingerprint || parent.outcome !== 'admitted')) ||
    grant.attempts.some(
      (attempt) => attempt.id !== identity.id && ['admitted', 'unknown'].includes(attempt.outcome)
    )
  )
    throw new AssessmentFenceConflict();
  return pending;
}

/** Use before execution admission. The journal itself serializes competing begins. */
export async function requireAssessmentExecutionAdmission(
  database: Prisma.TransactionClient,
  identity: Identity,
  execution: SottoProviderExecution
) {
  const pending = await validateAssessmentExecutionState(database, identity, execution);
  await sottoJobExecutions(database).requireParentDrained(identity.id, identity.fingerprint);
  return pending;
}
