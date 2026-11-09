import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import type { Queue } from 'bullmq';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { snapshotFailedSottoDelivery, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  assertSottoExecutionOperation,
  sottoJobExecutions,
  type SottoJobExecutionCapability,
  type SottoJobExecutionOperation,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  durableEnvelopeSchema,
  durableQueueOperationId,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import {
  readCompletedAssessmentAudioAttempt,
  readRetainedAssessmentAudioAttempt,
  verifyRetainedAssessmentAudioPublication,
} from './assessment-audio-attempt';
import { readAssessmentAudioSettlementLineage } from './assessment-audio-lineage';
import {
  requireAssessmentAudioObservation,
  releaseAssessmentAudioObservationInTrackedOperation,
  runAssessmentAudioObservationTransaction,
  trackAssessmentAudioObservationOperation,
} from './assessment-audio-claim';
import {
  assessmentFenceBackend,
  assessmentFenceStore,
  AssessmentFenceConflict,
} from '../lifecycle/assessment-fence';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import { fenceAssessmentStorageInputs } from '../lifecycle/assessment-storage-fence';

const scopeSchema = z
  .object({ subjectId: z.string().min(1), generation: z.number().int().nonnegative().safe() })
  .strict();
const childSchema = z
  .object({
    episodeId: z.string().min(1),
    audioGenerationKey: z.string().min(1),
    segmentId: z.string().min(1),
    segmentVersion: z.number().int().positive(),
    speaker: z.string().min(1),
    text: z.string().min(1),
    previousText: z.string().optional(),
    nextText: z.string().optional(),
  })
  .strict();
const receiptSchema = z
  .object({
    version: z.literal(1),
    childId: z.uuid(),
    childFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    parentId: z.uuid(),
    parentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    assessmentId: z.string().min(1),
    episodeId: z.string().min(1),
    segmentId: z.string().min(1),
    generationKey: z.string().min(1),
    attemptStatus: z.enum(['ABSENT', 'ACTIVE']),
    deliveryAttempts: z.number().int().positive(),
    failedAt: z.number().int().positive().safe(),
    processedAt: z.number().int().positive().safe(),
  })
  .strict();
const observationSchema = z
  .object({
    operationId: z.uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    deliveryAttempts: z.number().int().positive(),
    failedAt: z.number().int().positive().safe(),
    processedAt: z.number().int().positive().safe(),
    claimNonce: z.uuid(),
  })
  .strict();

type ObservationIdentity = {
  classId: string;
  classGeneration: number;
  assessmentId: string;
  operationId: string;
  fingerprint: string;
  nonce: string;
};
export type FailedAssessmentAudioEvidence = object;
const failedEvidence = new WeakMap<
  FailedAssessmentAudioEvidence,
  { operation: SottoJobExecutionOperation; observation: z.infer<typeof observationSchema> }
>();

/** Capture Redis evidence while the exact child execution and claim are live. */
export async function captureFailedAssessmentAudioEvidence(input: {
  database: PrismaClient;
  queue: Queue;
  identity: ObservationIdentity;
  capability: SottoJobExecutionCapability;
  operation: SottoJobExecutionOperation;
}): Promise<FailedAssessmentAudioEvidence> {
  const { identity, operation } = input;
  const expected = { parentId: identity.operationId, fingerprint: identity.fingerprint };
  assertSottoExecutionOperation(operation, expected);
  const { nonce, ...claimIdentity } = identity;
  const record = await runAssessmentAudioObservationTransaction(
    { ...input, identity: claimIdentity },
    async (database) =>
      await trackAssessmentAudioObservationOperation(database, operation, expected, async () => {
        await requireAssessmentAudioObservation(database, identity, operation);
        const child = await sottoJobOutbox(database).read(identity.operationId);
        if (!child || child.complete || child.fingerprint !== identity.fingerprint)
          throw new AssessmentFenceConflict();
        return child;
      })
  );
  const snapshot = await snapshotFailedSottoDelivery(input.queue, record);
  assertSottoExecutionOperation(operation, expected);
  const evidence = Object.freeze({});
  failedEvidence.set(evidence, {
    operation,
    observation: observationSchema.parse({ ...snapshot, claimNonce: nonce }),
  });
  return evidence;
}

/** Only evidence captured by this exact live operation may authorize a receipt. */
export function recordObservedFailedAssessmentAudio(
  database: Prisma.TransactionClient,
  evidence: FailedAssessmentAudioEvidence,
  operation: SottoJobExecutionOperation
) {
  const captured = failedEvidence.get(evidence);
  if (!captured || captured.operation !== operation) throw new AssessmentFenceConflict();
  return recordFailedAssessmentAudio(database, captured.observation, operation);
}

/** Complete a verified publication and release its observation claim atomically. */
export async function completeObservedAssessmentAudioPublication(
  database: Prisma.TransactionClient,
  identity: ObservationIdentity,
  evidence: FailedAssessmentAudioEvidence,
  operation: SottoJobExecutionOperation
) {
  const captured = failedEvidence.get(evidence);
  if (
    !captured ||
    captured.operation !== operation ||
    captured.observation.operationId !== identity.operationId ||
    captured.observation.fingerprint !== identity.fingerprint ||
    captured.observation.claimNonce !== identity.nonce
  )
    throw new AssessmentFenceConflict();
  const expected = { parentId: identity.operationId, fingerprint: identity.fingerprint };
  return await trackAssessmentAudioObservationOperation(database, operation, expected, async () => {
    const result = await recordFailedObservation(database, captured.observation, operation);
    if (result.status !== 'PUBLISHED') throw new AssessmentFenceConflict();
    const child = await sottoJobOutbox(database).read(identity.operationId);
    if (!child || child.complete || child.fingerprint !== identity.fingerprint)
      throw new AssessmentFenceConflict();
    const payload = childSchema.parse(durableEnvelopeSchema.parse(child.job.payload).payload);
    const completed = {
      episodeId: payload.episodeId,
      segmentId: payload.segmentId,
      generationKey: payload.audioGenerationKey,
      operationId: identity.operationId,
    };
    await readCompletedAssessmentAudioAttempt(database, completed);
    const segment = await database.segment.findUniqueOrThrow({
      where: { id: payload.segmentId },
      select: { audioUrl: true },
    });
    if (!segment.audioUrl) throw new AssessmentFenceConflict();
    const storage = await resolveStorageInput(database, {
      consumer: `segment:${payload.segmentId}:audio`,
      reference: segment.audioUrl,
    });
    await fenceAssessmentStorageInputs(database, [storage.input]);
    await readCompletedAssessmentAudioAttempt(database, completed);
    await releaseAssessmentAudioObservationInTrackedOperation(database, identity, operation);
    if (!(await sottoJobOutbox(database).complete(identity.operationId, identity.fingerprint)))
      throw new AssessmentFenceConflict();
    return { status: 'PUBLISHED' as const };
  });
}

/** Verify a completed child after a lost response without repeating its effects. */
export async function verifyCompletedAssessmentAudioDelivery(
  database: Prisma.TransactionClient,
  identity: Omit<ObservationIdentity, 'nonce'>
) {
  const outbox = sottoJobOutbox(database);
  const child = await outbox.read(identity.operationId);
  if (
    !child ||
    !child.complete ||
    child.fingerprint !== identity.fingerprint ||
    child.job.handler !== 'audio-generation' ||
    child.job.version !== 1 ||
    !child.job.scopes.some(
      (scope) =>
        scope.subjectId === `class:${identity.classId}` &&
        scope.generation === identity.classGeneration
    )
  )
    throw new AssessmentFenceConflict();
  const envelope = durableEnvelopeSchema.parse(child.job.payload);
  const payload = childSchema.parse(envelope.payload);
  if (
    envelope.type !== 'generate_audio' ||
    envelope.authority.kind !== 'episode' ||
    envelope.authority.episodeId !== payload.episodeId ||
    envelope.authority.preparationAudioGenerationKey !== payload.audioGenerationKey
  )
    throw new AssessmentFenceConflict();
  const episode = await database.episode.findUnique({
    where: { id: payload.episodeId },
    select: { assessmentAudioAssessmentId: true },
  });
  if (episode?.assessmentAudioAssessmentId !== identity.assessmentId)
    throw new AssessmentFenceConflict();
  const assessment = await database.classAssessment.findUnique({
    where: { id: identity.assessmentId },
    select: { classId: true, class: { select: { createdAt: true } } },
  });
  if (
    assessment?.classId !== identity.classId ||
    assessment.class.createdAt.getTime() !== identity.classGeneration
  )
    throw new AssessmentFenceConflict();
  const completed = {
    episodeId: payload.episodeId,
    segmentId: payload.segmentId,
    generationKey: payload.audioGenerationKey,
    operationId: identity.operationId,
  };
  await readCompletedAssessmentAudioAttempt(database, completed);
  const segment = await database.segment.findUniqueOrThrow({
    where: { id: payload.segmentId },
    select: { audioUrl: true },
  });
  if (!segment.audioUrl) throw new AssessmentFenceConflict();
  const storage = await resolveStorageInput(database, {
    consumer: `segment:${payload.segmentId}:audio`,
    reference: segment.audioUrl,
  });
  await fenceAssessmentStorageInputs(database, [storage.input]);
  await readCompletedAssessmentAudioAttempt(database, completed);
  const locked = await outbox.read(identity.operationId);
  if (!locked || !isDeepStrictEqual(locked, child)) throw new AssessmentFenceConflict();
  const executions = sottoJobExecutions(database);
  if (await executions.blockingStatus(identity.operationId, identity.fingerprint))
    return { status: 'WAITING' as const };
  await executions.requireParentDrained(identity.operationId, identity.fingerprint);
  return { status: 'DRAINED' as const };
}

function receiptPrefix(classId: string, classGeneration: number) {
  const key = createHash('sha256')
    .update(JSON.stringify([classId, classGeneration]))
    .digest('hex');
  return `${SIDEDOOR_STATE_ID}:assessment-audio-failure:${key}:`;
}

function receiptBackend(
  database: Prisma.TransactionClient,
  classId: string,
  classGeneration: number,
  childId: string
) {
  return sqlStateBackend(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    `${receiptPrefix(classId, classGeneration)}${childId}`
  );
}

/** An orphaned failure receipt must block deletion until recovery can inventory it. */
export async function hasRetainedAssessmentAudioFailures(
  database: Prisma.TransactionClient,
  classId: string,
  classGeneration: number
) {
  return Boolean(
    await database.sidedoorState.findFirst({
      where: { id: { startsWith: receiptPrefix(classId, classGeneration) } },
      select: { id: true },
    })
  );
}

/** Recognize an already fenced failure without creating another execution. */
export async function hasRecordedAssessmentAudioFailure(
  database: Prisma.TransactionClient,
  identity: {
    classId: string;
    classGeneration: number;
    assessmentId: string;
    operationId: string;
    fingerprint: string;
  }
) {
  const store = receiptBackend(
    database,
    identity.classId,
    identity.classGeneration,
    identity.operationId
  );
  const stored = await store.read();
  if (!stored) return false;
  const receipt = receiptSchema.parse(stored.state);
  const child = await sottoJobOutbox(database).read(identity.operationId);
  if (
    !child ||
    child.complete ||
    child.fingerprint !== identity.fingerprint ||
    child.job.handler !== 'audio-generation' ||
    child.job.version !== 1 ||
    receipt.childId !== identity.operationId ||
    receipt.childFingerprint !== identity.fingerprint ||
    receipt.assessmentId !== identity.assessmentId
  )
    throw new AssessmentFenceConflict();
  const envelope = durableEnvelopeSchema.parse(child.job.payload);
  const payload = childSchema.parse(envelope.payload);
  if (
    envelope.type !== 'generate_audio' ||
    envelope.authority.kind !== 'episode' ||
    envelope.authority.episodeId !== payload.episodeId ||
    envelope.authority.preparationAudioGenerationKey !== payload.audioGenerationKey ||
    receipt.episodeId !== payload.episodeId ||
    receipt.segmentId !== payload.segmentId ||
    receipt.generationKey !== payload.audioGenerationKey ||
    identity.operationId !==
      durableQueueOperationId(
        'audio-generation',
        `audio-${payload.episodeId}-${payload.segmentId}-v${payload.segmentVersion}-${payload.audioGenerationKey}`
      )
  )
    throw new AssessmentFenceConflict();
  const { lineage, current } = await readAssessmentAudioSettlementLineage(
    database,
    payload.episodeId,
    payload.audioGenerationKey
  );
  const classScope = current.ownership.scopes.find(
    (item) => item.subjectId === `class:${current.classId}`
  );
  const assessment = await database.classAssessment.findUnique({
    where: { id: identity.assessmentId },
    select: { status: true, sealedAt: true },
  });
  if (
    current.classId !== identity.classId ||
    current.assessmentId !== identity.assessmentId ||
    classScope?.generation !== identity.classGeneration ||
    current.status !== 'UNRESOLVED' ||
    assessment?.status !== 'UNRESOLVED' ||
    assessment.sealedAt !== null ||
    lineage.identity.id !== receipt.parentId ||
    lineage.identity.fingerprint !== receipt.parentFingerprint ||
    !isDeepStrictEqual(
      child.job.scopes,
      z
        .object({ scopes: z.array(scopeSchema) })
        .passthrough()
        .parse(lineage.storage).scopes
    )
  )
    throw new AssessmentFenceConflict();
  const locked = await sottoJobOutbox(database).read(identity.operationId);
  const lockedReceipt = await store.read();
  if (
    !locked ||
    !isDeepStrictEqual(locked, child) ||
    !lockedReceipt ||
    lockedReceipt.revision !== stored.revision ||
    !isDeepStrictEqual(lockedReceipt.state, stored.state)
  )
    throw new AssessmentFenceConflict();
  return true;
}

/** Called only after the exact terminal delivery is independently observed in Redis. */
async function recordFailedAssessmentAudio(
  database: Prisma.TransactionClient,
  observation: {
    operationId: string;
    fingerprint: string;
    deliveryAttempts: number;
    failedAt: number;
    processedAt: number;
    claimNonce: string;
  },
  operation: SottoJobExecutionOperation
) {
  return trackAssessmentAudioObservationOperation(
    database,
    operation,
    { parentId: observation.operationId, fingerprint: observation.fingerprint },
    () => recordFailedObservation(database, observation, operation)
  );
}

async function recordFailedObservation(
  database: Prisma.TransactionClient,
  observation: {
    operationId: string;
    fingerprint: string;
    deliveryAttempts: number;
    failedAt: number;
    processedAt: number;
    claimNonce: string;
  },
  operation: SottoJobExecutionOperation
) {
  observation = observationSchema.parse(observation);
  const child = await sottoJobOutbox(database).read(observation.operationId);
  if (
    !child ||
    child.complete ||
    child.fingerprint !== observation.fingerprint ||
    child.job.handler !== 'audio-generation' ||
    child.job.version !== 1
  )
    throw new AssessmentFenceConflict();
  const envelope = durableEnvelopeSchema.parse(child.job.payload);
  const payload = childSchema.parse(envelope.payload);
  if (
    envelope.type !== 'generate_audio' ||
    envelope.authority.kind !== 'episode' ||
    envelope.authority.episodeId !== payload.episodeId ||
    envelope.authority.preparationAudioGenerationKey !== payload.audioGenerationKey ||
    observation.operationId !==
      durableQueueOperationId(
        'audio-generation',
        `audio-${payload.episodeId}-${payload.segmentId}-v${payload.segmentVersion}-${payload.audioGenerationKey}`
      )
  )
    throw new AssessmentFenceConflict();
  const { lineage, current } = await readAssessmentAudioSettlementLineage(
    database,
    payload.episodeId,
    payload.audioGenerationKey
  );
  const lockedChild = await sottoJobOutbox(database).read(observation.operationId);
  if (!lockedChild || !isDeepStrictEqual(lockedChild, child)) throw new AssessmentFenceConflict();
  const storage = z
    .object({ scopes: z.array(scopeSchema).min(1) })
    .passthrough()
    .parse(lineage.storage);
  if (!isDeepStrictEqual(child.job.scopes, storage.scopes)) throw new AssessmentFenceConflict();
  const scope = current.ownership.scopes.find(
    (item) => item.subjectId === `class:${current.classId}`
  );
  if (!scope) throw new AssessmentFenceConflict();
  await requireAssessmentAudioObservation(
    database,
    {
      classId: current.classId,
      classGeneration: scope.generation,
      assessmentId: current.assessmentId,
      operationId: observation.operationId,
      fingerprint: observation.fingerprint,
      nonce: observation.claimNonce,
    },
    operation
  );
  const attempt = {
    classId: current.classId,
    courseId: current.courseId,
    userId: current.userId,
    classGeneration: scope.generation,
    scopes: storage.scopes,
    assessmentId: current.assessmentId,
    parentOperationId: current.id,
    episodeId: payload.episodeId,
    segmentId: payload.segmentId,
    generationKey: payload.audioGenerationKey,
    operationId: observation.operationId,
    fingerprint: observation.fingerprint,
  };
  const attemptStatus = await readRetainedAssessmentAudioAttempt(database, attempt);
  if (attemptStatus === 'COMPLETE') {
    await verifyRetainedAssessmentAudioPublication(database, {
      ...attempt,
      segmentVersion: payload.segmentVersion,
    });
    return { status: 'PUBLISHED' as const };
  }
  const receipt = receiptSchema.parse({
    version: 1,
    childId: observation.operationId,
    childFingerprint: observation.fingerprint,
    parentId: lineage.identity.id,
    parentFingerprint: lineage.identity.fingerprint,
    assessmentId: current.assessmentId,
    episodeId: payload.episodeId,
    segmentId: payload.segmentId,
    generationKey: payload.audioGenerationKey,
    attemptStatus,
    deliveryAttempts: observation.deliveryAttempts,
    failedAt: observation.failedAt,
    processedAt: observation.processedAt,
  });
  const store = receiptBackend(
    database,
    current.classId,
    scope.generation,
    observation.operationId
  );
  const previous = await store.read();
  if (previous && !isDeepStrictEqual(receiptSchema.parse(previous.state), receipt))
    throw new AssessmentFenceConflict();
  const expectedStatus = current.status === 'RUNNING' ? 'GENERATING' : 'UNRESOLVED';
  const assessment = await database.classAssessment.findUniqueOrThrow({
    where: { id: current.assessmentId },
    select: { status: true, sealedAt: true },
  });
  if (assessment.status !== expectedStatus || assessment.sealedAt !== null)
    throw new AssessmentFenceConflict();
  if (current.status === 'RUNNING') {
    const updated = await database.classAssessment.updateMany({
      where: { id: current.assessmentId, status: 'GENERATING', sealedAt: null },
      data: { status: 'UNRESOLVED' },
    });
    if (updated.count !== 1) throw new AssessmentFenceConflict();
    await assessmentFenceStore(assessmentFenceBackend(database, current.classId)).transact(
      (state) => {
        if (!isDeepStrictEqual(state.current, current)) throw new AssessmentFenceConflict();
        state.current = { ...current, status: 'UNRESOLVED' };
      }
    );
  }
  if (!previous && !(await store.compareAndSwap(null, { revision: randomUUID(), state: receipt })))
    throw new AssessmentFenceConflict();
  return { status: 'UNRESOLVED' as const };
}
