import type { Prisma } from '@/generated/prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { StorageReferenceRegistry } from 'thesidedoor-core/storage';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  captureSpeakingPromptStorage,
  captureSpeakingRecordingStorage,
  SpeakingStorageChangedError,
} from '@/lib/sidedoor/storage/core/speaking-storage';
import { resolveOwnedClassStorage } from '@/lib/learning/classes/lifecycle/assessment-storage-relocation';
import { hasRetainedAssessmentSpeakingState } from '@/lib/learning/classes/speaking/lifecycle/assessment-speaking-retention';
import {
  classSpeakingGradingPayloadSchema,
  speakingGradingPayloadSchema,
} from './speaking-grading-work';

type Scope = { subjectId: string; generation: number };
type RetiredSpeakingJob = { id: string; fingerprint: string; scope: Scope; hasGrant: boolean };

export class SpeakingDeletionConflict extends Error {
  constructor(message = 'Speaking grading is active or requires recovery before deletion.') {
    super(message);
    this.name = 'SpeakingDeletionConflict';
  }
}

/** Require exact class ownership and registered media before deleting formative speaking work. */
export async function inspectClassSpeakingMedia(
  database: Prisma.TransactionClient,
  input: { classId: string; courseId: string; userId: string; scope: Scope },
  jobs: readonly RetiredSpeakingJob[]
) {
  const registry = new StorageReferenceRegistry(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  const prompts = await database.speakingPrompt.findMany({
    where: { section: { classId: input.classId }, referenceTtsUrl: { not: null } },
    select: { id: true },
  });
  const recordings = await database.speakingRecording.findMany({
    where: {
      OR: [
        {
          sectionId: {
            in: (
              await database.classSection.findMany({
                where: { classId: input.classId },
                select: { id: true },
              })
            ).map((section) => section.id),
          },
        },
        { prompt: { section: { classId: input.classId } } },
      ],
    },
    select: { id: true, userId: true, status: true, gradingOperationId: true },
  });
  const belongs = (parents: Array<{ kind: string; parentId: string; courseId: string }>) =>
    parents.length === 1 &&
    parents[0]?.kind === 'class' &&
    parents[0].parentId === input.classId &&
    parents[0].courseId === input.courseId;
  const requireReference = async (
    consumer: string,
    reference: string,
    scopes: readonly Scope[]
  ) => {
    const asset = await registry.resolve({ consumer, reference });
    if (
      !asset ||
      ![...scopes, input.scope].every((scope) =>
        asset.prepared.scopes.some(
          (item) => item.subjectId === scope.subjectId && item.generation === scope.generation
        )
      )
    )
      throw new SpeakingDeletionConflict(
        'This class has speaking audio that requires complete media cleanup before deletion.'
      );
  };
  for (const prompt of prompts) {
    const captured = await captureSpeakingPromptStorage(database, prompt.id).catch(
      (error: unknown) => {
        if (error instanceof SpeakingStorageChangedError) throw new SpeakingDeletionConflict();
        throw error;
      }
    );
    if (!captured.reference || !belongs(captured.associations.parents))
      throw new SpeakingDeletionConflict();
    await requireReference(
      `speaking-prompt:${prompt.id}:reference`,
      captured.reference,
      captured.scopes
    );
  }
  for (const recording of recordings) {
    const captured = await captureSpeakingRecordingStorage(database, recording.id).catch(
      (error: unknown) => {
        if (error instanceof SpeakingStorageChangedError)
          throw new SpeakingDeletionConflict(
            'This class has speaking audio that requires complete media cleanup before deletion.'
          );
        throw error;
      }
    );
    if (
      recording.userId !== input.userId ||
      !['SCORED', 'FAILED'].includes(recording.status) ||
      !recording.gradingOperationId ||
      !jobs.some((job) => job.id === recording.gradingOperationId) ||
      !belongs(captured.associations.parents) ||
      !belongs(captured.associations.prompt.parents) ||
      captured.associations.parents[0]?.id !== captured.associations.prompt.parents[0]?.id
    )
      throw new SpeakingDeletionConflict(
        'This class has speaking audio that requires complete media cleanup before deletion.'
      );
    const record = await sottoJobOutbox(database).read(recording.gradingOperationId);
    if (!record || record.job.handler !== 'speaking-grading' || record.job.version !== 2)
      throw new SpeakingDeletionConflict();
    const payload = classSpeakingGradingPayloadSchema.parse(record.job.payload);
    if (
      payload.recordingId !== recording.id ||
      payload.classAuthorization.classId !== input.classId ||
      !isDeepStrictEqual(captured, { ...payload.ownership, reference: captured.reference }) ||
      !(await resolveOwnedClassStorage(database, {
        classId: input.classId,
        courseId: input.courseId,
        userId: input.userId,
        original: payload.storage,
        currentReference: captured.reference,
      }))
    )
      throw new SpeakingDeletionConflict();
    await requireReference(`recording:${recording.id}:audio`, captured.reference, captured.scopes);
  }
  return prompts.length > 0 || recordings.length > 0;
}

async function requireSafeLegacyJob(
  database: Prisma.TransactionClient,
  id: string,
  fingerprint: string,
  classId?: string
) {
  const record = await sottoJobOutbox(database).read(id);
  if (!record || record.fingerprint !== fingerprint)
    throw new Error('Legacy speaking deletion receipt changed');
  const payload = speakingGradingPayloadSchema.parse(record.job.payload);
  const parent = payload.ownership.associations.parents.find(
    (candidate) => candidate.kind === 'class'
  );
  if (!parent || (classId && parent.parentId !== classId)) return false;
  const recording = await database.speakingRecording.findUnique({
    where: { id: payload.recordingId },
    select: { status: true },
  });
  if (
    !record.complete ||
    recording?.status === 'UNRESOLVED' ||
    recording?.status === 'PENDING' ||
    recording?.status === 'GRADING'
  )
    throw new SpeakingDeletionConflict();
  await sottoJobExecutions(database).requireParentDrained(id, fingerprint);
  return true;
}

/** Legacy class jobs were indexed by course rather than class. */
export async function requireLegacySpeakingClassDeletionSafe(
  database: Prisma.TransactionClient,
  courseScope: Scope,
  classId: string
) {
  const outbox = sottoJobOutbox(database);
  let cursor: string | null = null;
  do {
    const page = await outbox.listForScope(courseScope.subjectId, courseScope.generation, cursor);
    for (const reference of page.jobs) {
      const receipt = await outbox.receipt(reference.id);
      if (!receipt || receipt.fingerprint !== reference.fingerprint)
        throw new Error('Legacy speaking deletion receipt changed');
      if (
        receipt.handler === 'speaking-grading' &&
        receipt.version === 1 &&
        receipt.status !== 'erased'
      ) {
        if (await requireSafeLegacyJob(database, reference.id, reference.fingerprint, classId))
          throw new SpeakingDeletionConflict(
            'This class has older speaking history that can only be removed with its course.'
          );
      }
    }
    cursor = page.cursor;
  } while (cursor !== null);
}

/** Inspect retained jobs before deletion tombstones their owning scope. */
export async function inspectSpeakingGradingDeletion(
  database: Prisma.TransactionClient,
  scopes: readonly Scope[],
  verifiedAssessmentJobs: readonly { id: string; fingerprint: string }[] = []
): Promise<RetiredSpeakingJob[]> {
  const outbox = sottoJobOutbox(database);
  const retained = new Map<string, RetiredSpeakingJob>();
  const verified = new Map(verifiedAssessmentJobs.map((job) => [job.id, job.fingerprint]));
  if (verified.size !== verifiedAssessmentJobs.length) throw new SpeakingDeletionConflict();
  for (const scope of scopes) {
    let cursor: string | null = null;
    do {
      const page = await outbox.listForScope(scope.subjectId, scope.generation, cursor);
      for (const reference of page.jobs) {
        if (retained.has(reference.id)) continue;
        const receipt = await outbox.receipt(reference.id);
        if (!receipt || receipt.fingerprint !== reference.fingerprint)
          throw new Error('Speaking grading deletion receipt changed');
        if (
          receipt.handler === 'speaking-grading' &&
          receipt.version === 1 &&
          receipt.status !== 'erased'
        ) {
          if (await requireSafeLegacyJob(database, reference.id, reference.fingerprint))
            retained.set(reference.id, { ...reference, scope, hasGrant: false });
          continue;
        }
        if (receipt.handler === 'speaking-grading' && receipt.version === 3) {
          if (receipt.status === 'erased') {
            if (await hasRetainedAssessmentSpeakingState(database, reference.id))
              throw new SpeakingDeletionConflict();
            continue;
          }
          if (receipt.status !== 'complete' || verified.get(reference.id) !== reference.fingerprint)
            throw new SpeakingDeletionConflict(
              'Assessment speaking history requires recovery before deletion.'
            );
          continue;
        }
        if (receipt.handler !== 'speaking-grading' || receipt.version !== 2) continue;
        if (receipt.status === 'erased') {
          const orphan = await database.sidedoorState.findUnique({
            where: { id: `${SIDEDOOR_STATE_ID}:speaking-grant:${reference.id}` },
          });
          if (orphan) throw new Error('Erased speaking work retains its provider grant');
          continue;
        }
        const record = await outbox.read(reference.id);
        if (!record || !record.complete || record.fingerprint !== reference.fingerprint)
          throw new SpeakingDeletionConflict();
        const payload = classSpeakingGradingPayloadSchema.parse(record.job.payload);
        if (
          scope.subjectId.startsWith('class:') &&
          scope.subjectId !== `class:${payload.classAuthorization.classId}`
        )
          throw new Error('Speaking grading class scope changed');
        const parent = payload.ownership.associations.parents.find(
          (candidate) =>
            candidate.kind === 'class' && candidate.parentId === payload.classAuthorization.classId
        );
        if (!parent || payload.grant.id !== reference.id)
          throw new Error('Speaking grading deletion ownership changed');
        await sottoJobExecutions(database).requireParentDrained(
          reference.id,
          reference.fingerprint
        );
        const grant = await learningPreparationGrant(
          database,
          {
            id: reference.id,
            userId: payload.ownership.associations.userId,
            courseId: parent.courseId,
          },
          'speaking'
        ).read(payload.grant);
        if (
          (grant.status !== 'completed' &&
            !(grant.status === 'revoked' && grant.attempts.length === 0)) ||
          grant.attempts.some(
            (attempt) => attempt.outcome === 'admitted' || attempt.outcome === 'unknown'
          )
        )
          throw new SpeakingDeletionConflict();
        retained.set(reference.id, { ...reference, scope, hasGrant: true });
      }
      cursor = page.cursor;
    } while (cursor !== null);
  }
  return [...retained.values()];
}

/** Remove exact drained work only after its captured scope has been tombstoned. */
export async function eraseSpeakingGradingDeletion(
  database: Prisma.TransactionClient,
  jobs: readonly RetiredSpeakingJob[]
) {
  for (const job of jobs) {
    await sottoJobOutbox(database).erase(job.id, job.fingerprint, job.scope);
    if (!job.hasGrant) continue;
    const erased = await database.sidedoorState.deleteMany({
      where: { id: `${SIDEDOOR_STATE_ID}:speaking-grant:${job.id}` },
    });
    if (erased.count !== 1) throw new Error('Speaking grading grant changed during deletion');
  }
}
