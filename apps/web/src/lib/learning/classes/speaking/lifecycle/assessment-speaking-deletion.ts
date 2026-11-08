import { isDeepStrictEqual } from 'node:util';
import { StorageCleanupJournal, StorageWriteJournal } from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { readAssessmentArchive } from '../../history/assessment-archive';
import { AssessmentFenceConflict } from '../../lifecycle/assessment-fence';
import { verifyFailedAssessmentSpeaking } from '../../history/assessment-failed-speaking';
import { readVerifiedHistoricalAssessmentGeneration } from '../../lifecycle/assessment-outcome';
import { verifyCompletedAssessmentSpeaking } from './assessment-speaking-recovery';
import { assessmentSpeakingPrelaunchReceiptId } from './assessment-speaking-prelaunch-receipt';
import { hasRetainedAssessmentSpeakingState } from './assessment-speaking-retention';
import {
  verifyFailedSpeakingForDeletion,
  type AssessmentSpeakingDeletionInput,
} from './assessment-speaking-failed-verification';

type DeletionInput = AssessmentSpeakingDeletionInput;
/** Verify a scored recording while its assessment and storage references still exist. */
export async function verifyAssessmentSpeakingForDeletion(
  database: Prisma.TransactionClient,
  input: DeletionInput
) {
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment speaking deletion requires a Serializable transaction.');
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${input.assessmentId} FOR UPDATE`;
  const assessment = await database.classAssessment.findFirst({
    where: {
      id: input.assessmentId,
      classId: input.classId,
      courseId: input.courseId,
      userId: input.userId,
    },
    select: { status: true, generationOperationId: true },
  });
  if (!assessment?.generationOperationId) throw new AssessmentFenceConflict();
  const identity = { operationId: input.operationId, fingerprint: input.fingerprint };
  if (assessment.status === 'READY') {
    const recording = await database.speakingRecording.findUnique({
      where: { id: input.recordingId },
      select: { status: true },
    });
    if (recording?.status === 'FAILED') {
      await verifyFailedSpeakingForDeletion(database, input);
      await sottoJobExecutions(database).requireParentDrained(input.operationId, input.fingerprint);
      return;
    }
    const result = await verifyCompletedAssessmentSpeaking(database, identity);
    if (
      !result?.record.complete ||
      result.recording.id !== input.recordingId ||
      result.payload.assessment.assessmentId !== input.assessmentId ||
      result.payload.assessment.classId !== input.classId ||
      result.payload.assessment.courseId !== input.courseId ||
      result.payload.assessment.userId !== input.userId
    )
      throw new AssessmentFenceConflict();
  } else if (assessment.status === 'COMMITTED') {
    const parent = await sottoJobOutbox(database).read(assessment.generationOperationId);
    if (!parent) throw new AssessmentFenceConflict();
    const history = await readVerifiedHistoricalAssessmentGeneration(database, {
      id: parent.job.id,
      fingerprint: parent.fingerprint,
    });
    const archive = await readAssessmentArchive(database, parent.job.id);
    const evidence = await verifyFailedAssessmentSpeaking(database, {
      classId: input.classId,
      assessmentId: input.assessmentId,
      material: history.material,
      generationFence: archive.fence,
      execution: {
        userId: input.userId,
        authorize: async (tx) => {
          await capturePrerequisiteOwnership(tx, input.classId, input.courseId, input.userId);
          return { userId: input.userId };
        },
      },
    });
    const recording = await database.speakingRecording.findUnique({
      where: { id: input.recordingId },
      select: { status: true },
    });
    if (recording?.status === 'FAILED') {
      await verifyFailedSpeakingForDeletion(database, input, {
        material: history.material,
        speakingPolicy: archive.fence.speakingPolicy,
      });
      await sottoJobExecutions(database).requireParentDrained(input.operationId, input.fingerprint);
      return;
    }
    const matches = evidence.filter((item) => item.operationId === input.operationId);
    if (matches.length !== 1) throw new AssessmentFenceConflict();
    const saved = await database.classAssessmentProductiveEvidence.findFirst({
      where: {
        assessmentId: input.assessmentId,
        operationId: input.operationId,
        operationFingerprint: input.fingerprint,
        speakingRecordingId: input.recordingId,
      },
      select: { id: true },
    });
    if (!saved) throw new AssessmentFenceConflict();
  } else throw new AssessmentFenceConflict();
  await sottoJobExecutions(database).requireParentDrained(input.operationId, input.fingerprint);
}

/** Match every assessment recording with exactly one retained class-scoped job. */
export async function inspectAssessmentSpeakingForDeletion(
  database: Prisma.TransactionClient,
  input: { classId: string; courseId: string; userId: string }
) {
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment speaking deletion requires a Serializable transaction.');
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE "classId" = ${input.classId} ORDER BY id FOR UPDATE`;
  const ownership = await capturePrerequisiteOwnership(
    database,
    input.classId,
    input.courseId,
    input.userId
  );
  const scope = ownership.scopes.find((item) => item.subjectId === `class:${input.classId}`);
  if (!scope) throw new AssessmentFenceConflict();
  const jobs = new Map<string, string>();
  const outbox = sottoJobOutbox(database);
  let cursor: string | null = null;
  do {
    const page = await outbox.listForScope(scope.subjectId, scope.generation, cursor);
    for (const reference of page.jobs) {
      const receipt = await outbox.receipt(reference.id);
      if (!receipt || receipt.fingerprint !== reference.fingerprint)
        throw new AssessmentFenceConflict();
      if (receipt.handler !== 'speaking-grading' || receipt.version !== 3) continue;
      if (receipt.status !== 'complete' || jobs.has(reference.id))
        throw new AssessmentFenceConflict();
      jobs.set(reference.id, reference.fingerprint);
    }
    if (page.cursor !== null && cursor !== null && page.cursor <= cursor)
      throw new AssessmentFenceConflict();
    cursor = page.cursor;
  } while (cursor !== null);
  const verified = [];
  let after: string | undefined;
  while (true) {
    const recordings = await database.speakingRecording.findMany({
      where: {
        ...(after ? { id: { gt: after } } : {}),
        OR: [
          { assessmentSection: { assessment: { classId: input.classId } } },
          { prompt: { assessmentSection: { assessment: { classId: input.classId } } } },
        ],
      },
      select: {
        id: true,
        gradingOperationId: true,
        assessmentSection: { select: { assessmentId: true } },
      },
      orderBy: { id: 'asc' },
      take: 100,
    });
    for (const recording of recordings) {
      const operationId = recording.gradingOperationId;
      const fingerprint = operationId ? jobs.get(operationId) : undefined;
      if (!operationId || !fingerprint || !recording.assessmentSection)
        throw new AssessmentFenceConflict();
      await verifyAssessmentSpeakingForDeletion(database, {
        ...input,
        assessmentId: recording.assessmentSection.assessmentId,
        recordingId: recording.id,
        operationId,
        fingerprint,
      });
      verified.push({ id: operationId, fingerprint });
      jobs.delete(operationId);
    }
    if (recordings.length < 100) break;
    after = recordings[recordings.length - 1]!.id;
  }
  if (jobs.size) throw new AssessmentFenceConflict();
  return verified;
}

/** Confirm broader deletion scopes contain exactly the previously verified jobs. */
export async function reconcileAssessmentSpeakingDeletionScopes(
  database: Prisma.TransactionClient,
  scopes: readonly { subjectId: string; generation: number }[],
  verified: readonly { id: string; fingerprint: string }[]
) {
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment speaking deletion requires a Serializable transaction.');
  const expected = new Map(verified.map((item) => [item.id, item.fingerprint]));
  if (
    expected.size !== verified.length ||
    scopes.length === 0 ||
    new Set(scopes.map((scope) => scope.subjectId)).size !== scopes.length
  )
    throw new AssessmentFenceConflict();
  const seen = new Map<string, { subjectId: string; generation: number }>();
  const outbox = sottoJobOutbox(database);
  for (const scope of scopes) {
    let cursor: string | null = null;
    do {
      const page = await outbox.listForScope(scope.subjectId, scope.generation, cursor);
      for (const reference of page.jobs) {
        const receipt = await outbox.receipt(reference.id);
        if (!receipt || receipt.fingerprint !== reference.fingerprint)
          throw new AssessmentFenceConflict();
        if (receipt.handler !== 'speaking-grading' || receipt.version !== 3) continue;
        if (receipt.status === 'erased') {
          if (await hasRetainedAssessmentSpeakingState(database, reference.id))
            throw new AssessmentFenceConflict();
          continue;
        }
        if (receipt.status !== 'complete' || expected.get(reference.id) !== reference.fingerprint)
          throw new AssessmentFenceConflict();
        const record = await outbox.read(reference.id);
        if (
          !record ||
          !record.complete ||
          record.fingerprint !== reference.fingerprint ||
          !record.job.scopes.some((item) => isDeepStrictEqual(item, scope))
        )
          throw new AssessmentFenceConflict();
        if (!seen.has(reference.id)) seen.set(reference.id, scope);
      }
      if (page.cursor !== null && cursor !== null && page.cursor <= cursor)
        throw new AssessmentFenceConflict();
      cursor = page.cursor;
    } while (cursor !== null);
  }
  if (seen.size !== expected.size) throw new AssessmentFenceConflict();
  return verified.map((item) => ({ ...item, scope: seen.get(item.id)! }));
}

/**
 * Erase work from the verified inventory after the caller inventories every
 * recording consumer and admits all storage manifests in this transaction.
 */
export async function eraseAssessmentSpeakingForDeletion(
  database: Prisma.TransactionClient,
  jobs: readonly {
    id: string;
    fingerprint: string;
    scope: { subjectId: string; generation: number };
  }[]
) {
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment speaking deletion requires a Serializable transaction.');
  if (new Set(jobs.map((job) => job.id)).size !== jobs.length) throw new AssessmentFenceConflict();
  const executor = {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
  const writes = new StorageWriteJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
  const cleanup = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
  for (const job of jobs) {
    const record = await sottoJobOutbox(database).read(job.id);
    if (
      !record ||
      !record.complete ||
      record.fingerprint !== job.fingerprint ||
      record.job.handler !== 'speaking-grading' ||
      record.job.version !== 3 ||
      !record.job.scopes.some((scope) => isDeepStrictEqual(scope, job.scope))
    )
      throw new AssessmentFenceConflict();
    await sottoJobExecutions(database).requireParentDrained(job.id, job.fingerprint);
    const tombstone = await writes.tombstone(job.scope.subjectId);
    if (!tombstone || tombstone.generation !== job.scope.generation)
      throw new AssessmentFenceConflict();
    const admitted = await cleanup.get(tombstone.jobId);
    if (
      admitted.namespace !== SIDEDOOR_STATE_ID ||
      admitted.subjectId !== job.scope.subjectId ||
      admitted.generation !== job.scope.generation ||
      admitted.retentionPolicy !== 'job-id-snapshots-v1' ||
      admitted.phase !== 'preparing' ||
      admitted.inventoryCount < 1 ||
      admitted.manifestCount < 1 ||
      admitted.unresolvedManifests !== 0
    )
      throw new AssessmentFenceConflict();
    const erased = await sottoJobSnapshot(database).eraseNext(job.id, job.fingerprint);
    if (!erased.complete) throw new AssessmentFenceConflict();
    await sottoJobOutbox(database).erase(job.id, job.fingerprint, job.scope);
    const grant = await database.sidedoorState.deleteMany({
      where: { id: `${SIDEDOOR_STATE_ID}:speaking-grant:${job.id}` },
    });
    if (grant.count !== 1) throw new AssessmentFenceConflict();
    const proof = await database.sidedoorState.deleteMany({
      where: {
        id: {
          in: [
            `${SIDEDOOR_STATE_ID}:assessment-speaking-launch:${job.id}`,
            assessmentSpeakingPrelaunchReceiptId(job.id),
          ],
        },
      },
    });
    if (proof.count !== 1) throw new AssessmentFenceConflict();
  }
}
