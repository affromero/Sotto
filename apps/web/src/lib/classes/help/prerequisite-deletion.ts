import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  prepareStorageBackend,
  prepareStorageCleanup,
  StorageBackendRegistry,
  StorageCleanupJournal,
  StorageWriteJournal,
} from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import type { captureStorageBackend } from '@/lib/r2';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { worksheetPdfPayloadSchema } from '@/lib/sidedoor/jobs/stitch/worksheet-pdf-work';
import type { StorageDeletionInventoryScope } from '@/lib/storage/sidedoor/deletion-targets';
import { prerequisiteOutcomeSchema } from './lifecycle/prerequisite-contract';
import {
  prerequisiteFenceBackend,
  prerequisiteFenceStateId,
  prerequisiteFenceStore,
  prerequisiteWorkSchema,
} from './lifecycle/prerequisite-fence';
import { capturePrerequisiteOwnership } from './lifecycle/prerequisite-ownership';
import { requireRetirablePrerequisite } from './lifecycle/prerequisite-retirement';
import { previousPrerequisiteUuid } from './prerequisite-recovery-cursor';
import { eraseSpeakingGradingDeletion } from '@/lib/sidedoor/jobs/stitch/speaking-grading-deletion';
import { listAssessmentAudioAttempts } from '@/lib/learning/classes/audio/assessment-audio-attempt';
import { inspectAssessmentAudioForDeletion } from '@/lib/learning/classes/audio/assessment-audio-deletion';
import { hasRetainedAssessmentAudioFailures } from '@/lib/learning/classes/audio/assessment-audio-failure';
import { inspectReleasedAssessmentAudioClaims } from '@/lib/learning/classes/audio/assessment-audio-claim';
import {
  AssessmentFenceConflict,
  assessmentFenceBackend,
  assessmentFenceStateId,
  assessmentFenceStore,
} from '@/lib/learning/classes/lifecycle/assessment-fence';
import {
  recoverAssessmentOutcome,
  verifyHistoricalAssessmentGeneration,
} from '@/lib/learning/classes/lifecycle/assessment-outcome';
import { readAssessmentWritingRecovery } from '@/lib/learning/classes/writing/assessment-writing-recovery';
import { writingExecutionSchema } from '@/lib/learning/writing/writing-execution';
import { inspectAssessmentSpeakingForDeletion } from '@/lib/learning/classes/speaking/lifecycle/assessment-speaking-deletion';
import {
  assessmentArchiveId,
  readAssessmentArchive,
} from '@/lib/learning/classes/history/assessment-archive';

export class PrerequisiteDeletionConflict extends Error {
  constructor(message = 'Prerequisite work is active or requires recovery before deletion.') {
    super(message);
    this.name = 'PrerequisiteDeletionConflict';
  }
}

const classCleanupReceiptSchema = z
  .object({
    classId: z.string().min(1),
    classGeneration: z.number().int().nonnegative().safe(),
    userId: z.string().min(1),
    userGeneration: z.number().int().nonnegative().safe(),
    jobId: z.uuid(),
    episodeJobs: z
      .array(
        z
          .object({
            episodeId: z.string().min(1),
            generation: z.number().int().nonnegative().safe(),
            jobId: z.uuid(),
          })
          .strict()
      )
      .optional(),
  })
  .strict();

function classCleanupReceiptId(classId: string) {
  return `${SIDEDOOR_STATE_ID}:class-cleanup:${classId}`;
}

async function readEpisodeCleanupJobs(
  writes: StorageWriteJournal,
  cleanup: StorageCleanupJournal,
  entries: NonNullable<z.infer<typeof classCleanupReceiptSchema>['episodeJobs']>
) {
  const ids = new Set<string>();
  const jobs = [];
  for (const entry of entries) {
    if (ids.has(entry.episodeId)) throw new PrerequisiteDeletionConflict();
    ids.add(entry.episodeId);
    const subjectId = `episode:${entry.episodeId}`;
    const tombstone = await writes.tombstone(subjectId);
    const job = await cleanup.get(entry.jobId);
    if (
      !tombstone ||
      tombstone.jobId !== entry.jobId ||
      tombstone.generation !== entry.generation ||
      job.id !== entry.jobId ||
      job.subjectId !== subjectId ||
      job.generation !== entry.generation ||
      job.namespace !== SIDEDOOR_STATE_ID ||
      job.retentionPolicy !== 'job-id-snapshots-v1'
    )
      throw new PrerequisiteDeletionConflict();
    jobs.push({ id: job.id, phase: job.phase });
  }
  return jobs;
}

/** Bind a class cleanup to the authenticated owner before the class is removed. */
export async function recordPrerequisiteClassDeletion(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    classGeneration: number;
    userId: string;
    jobId: string;
    episodeJobs?: { episodeId: string; generation: number; jobId: string }[];
  }
) {
  const user = await database.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { createdAt: true },
  });
  const cls = await database.courseClass.findFirst({
    where: { id: input.classId, course: { userId: input.userId } },
    select: { createdAt: true },
  });
  const executor = {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
  const subjectId = `class:${input.classId}`;
  const tombstone = await new StorageWriteJournal(
    executor,
    'postgres',
    SIDEDOOR_STATE_ID
  ).tombstone(subjectId);
  const job = await new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID).get(
    input.jobId
  );
  if (
    !cls ||
    cls.createdAt.getTime() !== input.classGeneration ||
    !tombstone ||
    tombstone.jobId !== input.jobId ||
    tombstone.generation !== input.classGeneration ||
    job.subjectId !== subjectId ||
    job.generation !== input.classGeneration ||
    job.namespace !== SIDEDOOR_STATE_ID ||
    job.retentionPolicy !== 'job-id-snapshots-v1'
  )
    throw new PrerequisiteDeletionConflict();
  const episodeIds = new Set<string>();
  for (const entry of input.episodeJobs ?? []) {
    if (episodeIds.has(entry.episodeId)) throw new PrerequisiteDeletionConflict();
    episodeIds.add(entry.episodeId);
    const episode = await database.episode.findFirst({
      where: {
        id: entry.episodeId,
        userId: input.userId,
        classSection: { classId: input.classId },
      },
      select: { createdAt: true },
    });
    const episodeTombstone = await new StorageWriteJournal(
      executor,
      'postgres',
      SIDEDOOR_STATE_ID
    ).tombstone(`episode:${entry.episodeId}`);
    const episodeJob = await new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID).get(
      entry.jobId
    );
    if (
      !episode ||
      episode.createdAt.getTime() !== entry.generation ||
      !episodeTombstone ||
      episodeTombstone.jobId !== entry.jobId ||
      episodeTombstone.generation !== entry.generation ||
      episodeJob.subjectId !== `episode:${entry.episodeId}` ||
      episodeJob.generation !== entry.generation ||
      episodeJob.namespace !== SIDEDOOR_STATE_ID ||
      episodeJob.retentionPolicy !== 'job-id-snapshots-v1'
    )
      throw new PrerequisiteDeletionConflict();
  }
  const state = classCleanupReceiptSchema.parse({
    ...input,
    userGeneration: user.createdAt.getTime(),
  });
  const id = classCleanupReceiptId(input.classId);
  if (await database.sidedoorState.findUnique({ where: { id } }))
    throw new PrerequisiteDeletionConflict();
  await database.sidedoorState.create({ data: { id, revision: randomUUID(), state } });
}

/** Remove completed retry receipts before deleting a profile or resetting the instance. */
export async function eraseCompletedClassCleanupReceipts(
  database: Prisma.TransactionClient,
  userId?: string
) {
  const executor = {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
  const writes = new StorageWriteJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
  const cleanup = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
  const prefix = `${SIDEDOOR_STATE_ID}:class-cleanup:`;
  let after: string | undefined;
  while (true) {
    const rows = await database.sidedoorState.findMany({
      where: {
        id: { startsWith: prefix, ...(after ? { gt: after } : {}) },
        ...(userId ? { state: { path: ['userId'], equals: userId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 100,
    });
    for (const row of rows) {
      const saved = classCleanupReceiptSchema.parse(row.state);
      if (row.id !== classCleanupReceiptId(saved.classId) || (userId && saved.userId !== userId))
        throw new PrerequisiteDeletionConflict();
      const tombstone = await writes.tombstone(`class:${saved.classId}`);
      const job = await cleanup.get(saved.jobId);
      const episodeJobs = await readEpisodeCleanupJobs(writes, cleanup, saved.episodeJobs ?? []);
      if (
        !tombstone ||
        tombstone.jobId !== saved.jobId ||
        tombstone.generation !== saved.classGeneration ||
        job.subjectId !== `class:${saved.classId}` ||
        job.generation !== saved.classGeneration ||
        job.namespace !== SIDEDOOR_STATE_ID ||
        job.id !== saved.jobId ||
        job.retentionPolicy !== 'job-id-snapshots-v1' ||
        job.phase !== 'complete' ||
        episodeJobs.some((entry) => entry.phase !== 'complete')
      )
        throw new PrerequisiteDeletionConflict(
          'Finish pending class cleanup before deleting this profile.'
        );
      const removed = await database.sidedoorState.deleteMany({
        where: { id: row.id, revision: row.revision },
      });
      if (removed.count !== 1) throw new PrerequisiteDeletionConflict();
    }
    if (rows.length < 100) return;
    const next = rows[rows.length - 1]!.id;
    if (after && next <= after) throw new PrerequisiteDeletionConflict();
    after = next;
  }
}

export async function backfillDeletionJobScopes(database: Prisma.TransactionClient) {
  const isolation = await database.$queryRaw<
    Array<{ transaction_isolation: string }>
  >`SHOW transaction_isolation`;
  if (isolation[0]?.transaction_isolation !== 'serializable')
    throw new PrerequisiteDeletionConflict();
  const outbox = sottoJobOutbox(database);
  let cursor: string | null = null;
  do {
    const page = await outbox.backfillScopeIndex(cursor);
    if (page.cursor !== null && cursor !== null && page.cursor <= cursor)
      throw new PrerequisiteDeletionConflict();
    cursor = page.cursor;
  } while (cursor !== null);
}

/** Inspect every retained attempt under the class lock, before deletion is admitted. */
export async function inspectPrerequisiteDeletion(
  database: Prisma.TransactionClient,
  classId: string,
  courseId: string,
  userId: string,
  options: { allowAssessmentSpeaking?: boolean } = {}
) {
  await backfillDeletionJobScopes(database);
  return inspectIndexedPrerequisiteDeletion(database, classId, courseId, userId, options);
}

async function inspectIndexedPrerequisiteDeletion(
  database: Prisma.TransactionClient,
  classId: string,
  courseId: string,
  userId: string,
  options: { allowAssessmentSpeaking?: boolean } = {}
) {
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${classId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE "classId" = ${classId} ORDER BY id FOR UPDATE`;
  const ownership = await capturePrerequisiteOwnership(database, classId, courseId, userId);
  const assessments = await database.classAssessment.findMany({
    where: { classId },
    include: { sections: true },
  });
  const assessmentFence = (
    await assessmentFenceStore(assessmentFenceBackend(database, classId)).read()
  ).current;
  const audioAttempts = await listAssessmentAudioAttempts(database, { classId, courseId, userId });
  const classScope = ownership.scopes.find((scope) => scope.subjectId === `class:${classId}`);
  if (!classScope) throw new PrerequisiteDeletionConflict();
  if (await hasRetainedAssessmentAudioFailures(database, classId, classScope.generation))
    throw new PrerequisiteDeletionConflict();
  const assessmentOperations: Array<{ id: string; fingerprint: string }> = [];
  const writingOperations: Array<{ id: string; fingerprint: string; version: number }> = [];
  const assessmentSpeakingOperations = options.allowAssessmentSpeaking
    ? await inspectAssessmentSpeakingForDeletion(database, { classId, courseId, userId })
    : [];
  const prompts = new Set<string>();
  if (assessmentFence && !assessments.some((item) => item.id === assessmentFence.assessmentId))
    throw new PrerequisiteDeletionConflict();
  for (const assessment of assessments) {
    const operationId = assessment.generationOperationId;
    if (
      !operationId ||
      !['READY', 'COMMITTED'].includes(assessment.status) ||
      (!options.allowAssessmentSpeaking &&
        (await database.speakingRecording.count({
          where: {
            OR: [
              { assessmentSection: { assessmentId: assessment.id } },
              { prompt: { assessmentSection: { assessmentId: assessment.id } } },
            ],
          },
        })) > 0)
    )
      throw new PrerequisiteDeletionConflict();
    const parent = await sottoJobOutbox(database).read(operationId);
    if (!parent || parent.job.handler !== 'interactions' || parent.job.version !== 6)
      throw new PrerequisiteDeletionConflict();
    const assessmentOperation = { id: parent.job.id, fingerprint: parent.fingerprint };
    const archive = await readAssessmentArchive(database, operationId);
    if (
      archive.fingerprint !== parent.fingerprint ||
      archive.fence.assessmentId !== assessment.id ||
      !isDeepStrictEqual(archive.fence.ownership, ownership)
    )
      throw new PrerequisiteDeletionConflict();
    if (assessmentFence?.assessmentId === assessment.id) {
      if (
        !isDeepStrictEqual(assessmentFence, archive.fence) ||
        !(await recoverAssessmentOutcome(database, assessmentOperation))
      )
        throw new PrerequisiteDeletionConflict();
    } else if (!(await verifyHistoricalAssessmentGeneration(database, assessmentOperation)))
      throw new PrerequisiteDeletionConflict();
    assessmentOperations.push(assessmentOperation);
    const assessmentPrompts = await database.writingPrompt.findMany({
      where: { assessmentSection: { assessmentId: assessment.id } },
      select: { id: true },
    });
    for (const prompt of assessmentPrompts) prompts.add(prompt.id);
    const responses = await database.writingResponse.findMany({
      where: {
        OR: [
          { assessmentSection: { assessmentId: assessment.id } },
          { prompt: { assessmentSection: { assessmentId: assessment.id } } },
        ],
      },
    });
    for (const response of responses) {
      const parsed = writingExecutionSchema.safeParse(response.gradingState);
      if (!parsed.success || !assessmentPrompts.some((prompt) => prompt.id === response.promptId))
        throw new PrerequisiteDeletionConflict();
      const operation = parsed.data;
      const recovered = await readAssessmentWritingRecovery(database, {
        classId,
        assessmentId: assessment.id,
        promptId: response.promptId,
        execution: { userId, authorize: async () => ({ userId }) },
      });
      const record = await sottoJobOutbox(database).read(operation.id);
      if (
        !recovered ||
        recovered.status !== 'COMPLETED' ||
        recovered.responseId !== response.id ||
        recovered.operationId !== operation.id ||
        !record ||
        !record.complete ||
        record.fingerprint !== operation.fingerprint ||
        record.job.handler !== 'learning-writing' ||
        ![2, 3].includes(record.job.version)
      )
        throw new PrerequisiteDeletionConflict();
      const launch = await database.sidedoorState.findUnique({
        where: { id: `${SIDEDOOR_STATE_ID}:assessment-writing-launch:${operation.id}` },
      });
      const claim = z
        .object({ operationId: z.string(), fingerprint: z.string(), launchId: z.uuid() })
        .strict()
        .safeParse(launch?.state);
      if (
        !claim.success ||
        claim.data.operationId !== operation.id ||
        claim.data.fingerprint !== operation.fingerprint
      )
        throw new PrerequisiteDeletionConflict();
      writingOperations.push({
        id: operation.id,
        fingerprint: operation.fingerprint,
        version: record.job.version,
      });
    }
  }
  let audio: Awaited<ReturnType<typeof inspectAssessmentAudioForDeletion>>;
  try {
    audio = await inspectAssessmentAudioForDeletion(database, {
      classId,
      courseId,
      userId,
      ownership,
      attempts: audioAttempts,
      assessments: assessments.map((assessment) => {
        const operation = assessmentOperations.find(
          (item) => item.id === assessment.generationOperationId
        );
        if (!operation) throw new PrerequisiteDeletionConflict();
        return { ...operation, assessmentId: assessment.id };
      }),
    });
    audio.states.push(
      ...(await inspectReleasedAssessmentAudioClaims(database, {
        classId,
        classGeneration: classScope.generation,
        attempts: audioAttempts,
      }))
    );
  } catch (error) {
    if (error instanceof AssessmentFenceConflict || error instanceof z.ZodError)
      throw new PrerequisiteDeletionConflict();
    throw error;
  }
  if (assessments.length) {
    const courseScope = ownership.scopes.find((scope) => scope.subjectId === `course:${courseId}`);
    if (!courseScope) throw new PrerequisiteDeletionConflict();
    let writingCursor: string | null = null;
    const courseWritingSeen = new Set<string>();
    do {
      const outbox = sottoJobOutbox(database);
      const page = await outbox.listForScope(
        courseScope.subjectId,
        courseScope.generation,
        writingCursor
      );
      for (const reference of page.jobs) {
        const receipt = await outbox.receipt(reference.id);
        if (!receipt || receipt.fingerprint !== reference.fingerprint)
          throw new PrerequisiteDeletionConflict();
        if (
          receipt.handler !== 'learning-writing' ||
          ![1, 2, 3].includes(receipt.version) ||
          receipt.status === 'erased'
        )
          continue;
        const record = await outbox.read(reference.id);
        const payload = z.object({ promptId: z.string() }).safeParse(record?.job.payload);
        if (
          !record ||
          record.fingerprint !== reference.fingerprint ||
          !payload.success ||
          (prompts.has(payload.data.promptId) &&
            !writingOperations.some(
              (operation) =>
                operation.id === reference.id && operation.fingerprint === reference.fingerprint
            ))
        )
          throw new PrerequisiteDeletionConflict();
        if (prompts.has(payload.data.promptId)) courseWritingSeen.add(reference.id);
      }
      writingCursor = page.cursor;
    } while (writingCursor !== null);
    if (courseWritingSeen.size !== writingOperations.length)
      throw new PrerequisiteDeletionConflict();
  }
  const current = (await prerequisiteFenceStore(prerequisiteFenceBackend(database, classId)).read())
    .current;
  if (
    current &&
    (!isDeepStrictEqual(current.ownership, ownership) ||
      current.classId !== classId ||
      current.courseId !== courseId)
  )
    throw new PrerequisiteDeletionConflict();
  const outbox = sottoJobOutbox(database);
  const executions = sottoJobExecutions(database);
  const operations: Array<{ id: string; fingerprint: string }> = [];
  const copyOperations: Array<{ id: string; fingerprint: string }> = [];
  const worksheetOperations: Array<{ id: string; fingerprint: string }> = [];
  const assessmentsSeen = new Set<string>();
  const writingSeen = new Set<string>();
  const audioSeen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await outbox.listForScope(classScope.subjectId, classScope.generation, cursor);
    for (const reference of page.jobs) {
      const receipt = await outbox.receipt(reference.id);
      if (!receipt || receipt.fingerprint !== reference.fingerprint)
        throw new PrerequisiteDeletionConflict();
      if (receipt.handler === 'worksheet-pdf' && receipt.version === 2) {
        const record = await outbox.read(reference.id);
        const payload = worksheetPdfPayloadSchema.safeParse(record?.job.payload);
        if (
          receipt.status !== 'complete' ||
          !record?.complete ||
          record.fingerprint !== reference.fingerprint ||
          !payload.success ||
          payload.data.classId !== classId ||
          !isDeepStrictEqual(record.job.scopes, ownership.scopes)
        )
          throw new PrerequisiteDeletionConflict();
        await executions.requireParentDrained(reference.id, reference.fingerprint);
        worksheetOperations.push({ id: reference.id, fingerprint: reference.fingerprint });
        continue;
      }
      const audioJob = audio.jobs.find((job) => job.id === reference.id);
      if (audioJob) {
        if (
          receipt.status !== 'complete' ||
          receipt.fingerprint !== audioJob.fingerprint ||
          audioSeen.has(audioJob.id)
        )
          throw new PrerequisiteDeletionConflict();
        audioSeen.add(audioJob.id);
        continue;
      }
      if (
        options.allowAssessmentSpeaking &&
        receipt.handler === 'storage-migration-copy' &&
        receipt.version === 1
      ) {
        if (receipt.status !== 'complete') throw new PrerequisiteDeletionConflict();
        await executions.requireParentDrained(reference.id, reference.fingerprint);
        copyOperations.push({ id: reference.id, fingerprint: reference.fingerprint });
        continue;
      }
      if (receipt.handler === 'speaking-grading' && receipt.version === 3) {
        if (
          receipt.status !== 'complete' ||
          !assessmentSpeakingOperations.some(
            (item) => item.id === reference.id && item.fingerprint === reference.fingerprint
          )
        )
          throw new PrerequisiteDeletionConflict();
        continue;
      }
      if (receipt.handler === 'speaking-grading' && receipt.version === 2) continue;
      if (receipt.handler === 'learning-writing' && [2, 3].includes(receipt.version)) {
        const operation = writingOperations.find((item) => item.id === reference.id);
        if (
          !operation ||
          operation.fingerprint !== reference.fingerprint ||
          operation.version !== receipt.version ||
          receipt.status !== 'complete' ||
          writingSeen.has(operation.id)
        )
          throw new PrerequisiteDeletionConflict();
        writingSeen.add(operation.id);
        continue;
      }
      if (receipt.handler === 'interactions' && receipt.version === 6) {
        const operation = assessmentOperations.find((item) => item.id === reference.id);
        if (
          !operation ||
          reference.fingerprint !== operation.fingerprint ||
          receipt.status !== 'complete' ||
          assessmentsSeen.has(operation.id)
        )
          throw new PrerequisiteDeletionConflict();
        assessmentsSeen.add(operation.id);
        continue;
      }
      if (receipt.handler !== 'interactions' || receipt.version !== 5)
        throw new PrerequisiteDeletionConflict();
      const parent = await outbox.readParent(reference.id, {
        fingerprint: reference.fingerprint,
        handler: 'interactions',
        version: 5,
        scopes: ownership.scopes,
      });
      if (parent.status !== 'complete') throw new PrerequisiteDeletionConflict();
      const { fence } = prerequisiteWorkSchema.parse(parent.record.job.payload);
      if (
        fence.id !== reference.id ||
        fence.classId !== classId ||
        fence.courseId !== courseId ||
        fence.userId !== userId ||
        fence.status !== 'QUEUED' ||
        !isDeepStrictEqual(fence.ownership, ownership)
      )
        throw new PrerequisiteDeletionConflict();
      if (await executions.blockingStatus(reference.id, reference.fingerprint))
        throw new PrerequisiteDeletionConflict();
      await executions.requireParentDrained(reference.id, reference.fingerprint);
      const grant = await learningPreparationGrant(database, fence, 'prerequisite').read(
        fence.grant
      );
      if (grant.attempts.some((attempt) => ['admitted', 'unknown'].includes(attempt.outcome)))
        throw new PrerequisiteDeletionConflict();
      const snapshot = await sottoJobSnapshot(database).read(
        reference.id,
        reference.fingerprint,
        0
      );
      if (snapshot.pages !== 1 || snapshot.next !== null || snapshot.items.length !== 1)
        throw new PrerequisiteDeletionConflict();
      const result = prerequisiteOutcomeSchema.parse(snapshot.items[0]);
      if (
        result.sourceHash !== fence.sourceHash ||
        grant.status !== (result.status === 'READY' ? 'completed' : 'revoked')
      )
        throw new PrerequisiteDeletionConflict();
      operations.push(reference);
    }
    cursor = page.cursor;
  } while (cursor !== null);
  if (
    assessmentsSeen.size !== assessmentOperations.length ||
    writingSeen.size !== writingOperations.length ||
    audioSeen.size !== audio.jobs.length ||
    (current && !operations.some((operation) => operation.id === current.id)) ||
    (!current && operations.length > 0) ||
    (current && !['COMPLETED', 'FAILED'].includes(current.status))
  )
    throw new PrerequisiteDeletionConflict();
  if (current) await requireRetirablePrerequisite(database, current);
  return {
    classId,
    courseId,
    userId,
    classScope,
    scopes: ownership.scopes,
    operations,
    copyOperations,
    worksheetOperations,
    assessmentOperations,
    writingOperations,
    assessmentSpeakingOperations,
    audio,
  };
}

/** Capture class work before a broader deletion tombstones its owning scope. */
export async function inspectPrerequisiteDeletions(
  database: Prisma.TransactionClient,
  scope: StorageDeletionInventoryScope
) {
  await backfillDeletionJobScopes(database);
  if (
    scope.kind !== 'instance' &&
    scope.kind !== 'profile' &&
    scope.kind !== 'course' &&
    scope.kind !== 'class'
  )
    return [];
  const where: Prisma.CourseClassWhereInput =
    scope.kind === 'instance'
      ? {}
      : scope.kind === 'profile'
        ? { course: { userId: scope.id } }
        : scope.kind === 'class'
          ? { id: scope.id }
          : { courseId: scope.id };
  const inventories: Array<Awaited<ReturnType<typeof inspectPrerequisiteDeletion>>> = [];
  let after: string | undefined;
  while (true) {
    const classes = await database.courseClass.findMany({
      where: { ...where, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' },
      take: 100,
      select: { id: true, courseId: true, course: { select: { userId: true } } },
    });
    for (const cls of classes) {
      const inventory = await inspectIndexedPrerequisiteDeletion(
        database,
        cls.id,
        cls.courseId,
        cls.course.userId,
        { allowAssessmentSpeaking: true }
      );
      if (
        scope.kind === 'class' ||
        inventory.operations.length ||
        inventory.assessmentOperations.length ||
        inventory.copyOperations.length ||
        inventory.worksheetOperations.length
      )
        inventories.push(inventory);
    }
    if (classes.length < 100) return inventories;
    after = classes[classes.length - 1]!.id;
  }
}

/** Erase only a preflighted inventory, in the same transaction as its tombstone. */
export async function erasePrerequisiteDeletion(
  database: Prisma.TransactionClient,
  inventory: Awaited<ReturnType<typeof inspectPrerequisiteDeletion>>,
  scope = inventory.classScope
) {
  if (!inventory.scopes.some((captured) => isDeepStrictEqual(captured, scope)))
    throw new PrerequisiteDeletionConflict();
  const executor = {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
  const tombstone = await new StorageWriteJournal(
    executor,
    'postgres',
    SIDEDOOR_STATE_ID
  ).tombstone(scope.subjectId);
  if (!tombstone || tombstone.generation !== scope.generation)
    throw new PrerequisiteDeletionConflict();
  const cleanup = await new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID).get(
    tombstone.jobId
  );
  if (
    cleanup.namespace !== SIDEDOOR_STATE_ID ||
    cleanup.subjectId !== scope.subjectId ||
    cleanup.generation !== scope.generation
  )
    throw new PrerequisiteDeletionConflict();
  for (const operation of inventory.audio.jobs) {
    if (!(await sottoJobSnapshot(database).eraseNext(operation.id, operation.fingerprint)).complete)
      throw new PrerequisiteDeletionConflict();
    await sottoJobOutbox(database).erase(operation.id, operation.fingerprint, scope);
  }
  for (const operation of inventory.worksheetOperations) {
    await sottoJobOutbox(database).erase(operation.id, operation.fingerprint, scope);
  }
  for (const state of inventory.audio.states) {
    const removed = await database.sidedoorState.deleteMany({ where: state });
    if (removed.count !== 1) throw new PrerequisiteDeletionConflict();
  }
  for (const operation of inventory.operations) {
    const erased = await sottoJobSnapshot(database).eraseNext(operation.id, operation.fingerprint);
    if (!erased.complete) throw new PrerequisiteDeletionConflict();
    await sottoJobOutbox(database).erase(operation.id, operation.fingerprint, scope);
  }
  for (const operation of inventory.writingOperations) {
    const erased = await sottoJobSnapshot(database).eraseNext(operation.id, operation.fingerprint);
    if (!erased.complete) throw new PrerequisiteDeletionConflict();
    await sottoJobOutbox(database).erase(operation.id, operation.fingerprint, scope);
    for (const kind of ['writing-grant', 'assessment-writing-launch']) {
      const deleted = await database.sidedoorState.deleteMany({
        where: { id: `${SIDEDOOR_STATE_ID}:${kind}:${operation.id}` },
      });
      if (deleted.count !== 1) throw new PrerequisiteDeletionConflict();
    }
  }
  for (const operation of inventory.assessmentOperations) {
    const archive = await readAssessmentArchive(database, operation.id);
    if (
      archive.fingerprint !== operation.fingerprint ||
      archive.fence.classId !== inventory.classId
    )
      throw new PrerequisiteDeletionConflict();
    const archiveDeleted = await database.sidedoorState.deleteMany({
      where: { id: assessmentArchiveId(operation.id), revision: archive.revision },
    });
    if (archiveDeleted.count !== 1) throw new PrerequisiteDeletionConflict();
    let complete = false;
    for (let page = 0; page < 7 && !complete; page += 1)
      complete = (await sottoJobSnapshot(database).eraseNext(operation.id, operation.fingerprint))
        .complete;
    if (!complete) throw new PrerequisiteDeletionConflict();
    await sottoJobOutbox(database).erase(operation.id, operation.fingerprint, scope);
    const grantId = `${SIDEDOOR_STATE_ID}:assessment-grant:${operation.id}`;
    const grant = await database.sidedoorState.deleteMany({ where: { id: grantId } });
    if (grant.count !== 1) throw new PrerequisiteDeletionConflict();
  }
  if (inventory.assessmentOperations.length) {
    const fence = await database.sidedoorState.deleteMany({
      where: { id: assessmentFenceStateId(inventory.classId) },
    });
    if (fence.count !== 1) throw new PrerequisiteDeletionConflict();
  }
  const grantIds = inventory.operations.map(
    (operation) => `${SIDEDOOR_STATE_ID}:prerequisite-grant:${operation.id}`
  );
  const deleted = await database.sidedoorState.deleteMany({ where: { id: { in: grantIds } } });
  if (deleted.count !== grantIds.length) throw new PrerequisiteDeletionConflict();
  const fenceId = prerequisiteFenceStateId(inventory.classId);
  const fences = await database.sidedoorState.deleteMany({ where: { id: fenceId } });
  if (fences.count !== (inventory.operations.length ? 1 : 0))
    throw new PrerequisiteDeletionConflict();
}

/** Admit metadata-only cleanup for an individual class without touching course assets. */
export async function admitPrerequisiteClassDeletion(
  database: Prisma.TransactionClient,
  inventory: Awaited<ReturnType<typeof inspectPrerequisiteDeletion>>,
  capturedBackend: Awaited<ReturnType<typeof captureStorageBackend>>,
  speaking: Awaited<
    ReturnType<
      typeof import('@/lib/sidedoor/jobs/stitch/speaking-grading-deletion').inspectSpeakingGradingDeletion
    >
  > = []
) {
  if (
    !inventory.operations.length &&
    !inventory.assessmentOperations.length &&
    !inventory.worksheetOperations.length &&
    !speaking.length
  )
    throw new PrerequisiteDeletionConflict();
  const executor = {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
  const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, capturedBackend.descriptor);
  await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(backend);
  const journal = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
  const job = prepareStorageCleanup({
    namespace: SIDEDOOR_STATE_ID,
    ...inventory.classScope,
    retentionPolicy: 'job-id-snapshots-v1',
  });
  await journal.createJob(job);
  await journal.registerCollectors(job.id, job.epoch, [
    {
      id: 'empty',
      kind: 'inventory',
      backendIds: [backend.id],
      scope: `__sidedoor-empty/${job.id}`,
      match: 'key',
    },
  ]);
  await journal.recordManifestPage(job.id, job.epoch, {
    id: 'write-protocol',
    entries: [{ kind: 'write_protocol', version: 1 }],
  });
  await journal.resolveManifest(job.id, job.epoch, 'write-protocol', {
    resolver: 'sotto-learning-deletion-v1',
    entries: [{ index: 0, kind: 'non_storage', reason: 'Sidedoor write journal tombstone' }],
  });
  await erasePrerequisiteDeletion(database, inventory);
  await eraseSpeakingGradingDeletion(database, speaking);
  return job;
}

/** Recover a class cleanup only for the profile captured in every erased job. */
export async function recoverPrerequisiteClassDeletion(
  database: Prisma.TransactionClient,
  classId: string,
  userId: string
) {
  if (await database.courseClass.findUnique({ where: { id: classId }, select: { id: true } }))
    return null;
  const user = await database.user.findUnique({
    where: { id: userId },
    select: { createdAt: true },
  });
  if (!user) return null;
  const executor = {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
  const subjectId = `class:${classId}`;
  const writes = new StorageWriteJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
  if (await writes.tombstone(`profile:${userId}`)) return null;
  const tombstone = await writes.tombstone(subjectId);
  if (!tombstone) return null;
  const job = await new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID).get(
    tombstone.jobId
  );
  if (
    job.namespace !== SIDEDOOR_STATE_ID ||
    job.subjectId !== subjectId ||
    job.id !== tombstone.jobId ||
    job.generation !== tombstone.generation ||
    job.retentionPolicy !== 'job-id-snapshots-v1'
  )
    throw new PrerequisiteDeletionConflict();
  const receipt = await database.sidedoorState.findUnique({
    where: { id: classCleanupReceiptId(classId) },
  });
  if (receipt) {
    const saved = classCleanupReceiptSchema.parse(receipt.state);
    if (
      saved.classId !== classId ||
      saved.classGeneration !== tombstone.generation ||
      saved.userId !== userId ||
      saved.userGeneration !== user.createdAt.getTime() ||
      saved.jobId !== job.id
    )
      return null;
    const episodeJobs = await readEpisodeCleanupJobs(
      writes,
      new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID),
      saved.episodeJobs ?? []
    );
    return { id: job.id, phase: job.phase, episodeJobs };
  }
  const outbox = sottoJobOutbox(database);
  const remaining = new Map<string, string>();
  let cursor: string | null = null;
  do {
    const page = await outbox.listForScope(subjectId, tombstone.generation, cursor);
    for (const item of page.jobs) {
      const receipt = await outbox.receipt(item.id);
      if (
        !receipt ||
        receipt.status !== 'erased' ||
        !(
          (receipt.handler === 'interactions' && receipt.version === 5) ||
          (receipt.handler === 'interactions' && receipt.version === 6) ||
          (receipt.handler === 'learning-writing' && [2, 3].includes(receipt.version)) ||
          (receipt.handler === 'speaking-grading' && [2, 3].includes(receipt.version)) ||
          (receipt.handler === 'audio-generation' && receipt.version === 1) ||
          (receipt.handler === 'audio-stitching' && receipt.version === 2) ||
          (receipt.handler === 'storage-migration-copy' && receipt.version === 1)
        ) ||
        receipt.fingerprint !== item.fingerprint
      )
        throw new PrerequisiteDeletionConflict();
      remaining.set(item.id, item.fingerprint);
    }
    cursor = page.cursor;
  } while (cursor !== null);
  if (!remaining.size) return null;
  let profilePages = 0;
  for (const [id, fingerprint] of remaining) {
    cursor = previousPrerequisiteUuid(id);
    let found = false;
    do {
      if (++profilePages > 1000) return null;
      const page = await outbox.listForScope(`profile:${userId}`, user.createdAt.getTime(), cursor);
      for (const item of page.jobs) {
        if (item.id > id) return null;
        if (item.id === id) {
          if (item.fingerprint !== fingerprint) return null;
          found = true;
          break;
        }
      }
      if (page.cursor !== null && cursor !== null && page.cursor <= cursor)
        throw new PrerequisiteDeletionConflict();
      cursor = page.cursor;
    } while (!found && cursor !== null);
    if (!found) return null;
  }
  return { id: job.id, phase: job.phase, episodeJobs: [] };
}
