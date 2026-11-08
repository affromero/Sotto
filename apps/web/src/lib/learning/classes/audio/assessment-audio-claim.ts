import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  assertSottoExecutionOperation,
  runSottoExecutionTransaction,
  sottoJobExecutions,
  verifySottoExecutionOperation,
  type SottoJobExecutionCapability,
  type SottoJobExecutionOperation,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  durableEnvelopeSchema,
  durableQueueOperationId,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';

const identitySchema = z
  .object({
    classId: z.string().min(1),
    classGeneration: z.number().int().nonnegative().safe(),
    assessmentId: z.string().min(1),
    operationId: z.uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const claimSchema = identitySchema
  .extend({
    nonce: z.uuid(),
    status: z.enum(['CLAIMED', 'RELEASED']),
    execution: z
      .object({
        id: z.uuid(),
        parentId: z.uuid(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        executorId: z.uuid(),
      })
      .strict(),
  })
  .strict();
type Identity = z.infer<typeof identitySchema>;
type Binding = ReturnType<typeof assertSottoExecutionOperation>;
type TrackedTransaction = {
  binding: Binding;
  pending: Set<Promise<void>>;
  closing: boolean;
  actions: number;
  failed: boolean;
  result: unknown;
};
const trackedTransactions = new WeakMap<Prisma.TransactionClient, TrackedTransaction>();

/** Track the whole database commit under the same execution as the Redis observation. */
export function runAssessmentAudioObservationTransaction<Result>(
  input: {
    database: PrismaClient;
    identity: Identity;
    capability: SottoJobExecutionCapability;
    operation: SottoJobExecutionOperation;
  },
  run: (database: Prisma.TransactionClient) => Promise<Result>
) {
  const identity = identitySchema.parse(input.identity);
  const expected = { parentId: identity.operationId, fingerprint: identity.fingerprint };
  const outer = assertSottoExecutionOperation(input.operation, expected);
  return runSottoExecutionTransaction(
    input.capability,
    expected,
    input.database,
    async (database) => {
      const current = assertSottoExecutionOperation(input.operation, expected);
      if (!isDeepStrictEqual(current, outer)) throw new AssessmentFenceConflict();
      await verifySottoExecutionOperation(database, input.operation, expected);
      const tracked: TrackedTransaction = {
        binding: current,
        pending: new Set(),
        closing: false,
        actions: 0,
        failed: false,
        result: undefined,
      };
      trackedTransactions.set(database, tracked);
      try {
        const result = await run(database);
        if (tracked.pending.size) {
          tracked.closing = true;
          await Promise.all([...tracked.pending]);
          throw new AssessmentFenceConflict();
        }
        if (tracked.actions !== 1 || tracked.failed || !Object.is(result, tracked.result))
          throw new AssessmentFenceConflict();
        await verifySottoExecutionOperation(database, input.operation, expected);
        return result;
      } finally {
        tracked.closing = true;
        await Promise.all([...tracked.pending]);
        trackedTransactions.delete(database);
      }
    },
    { prepare: (database) => lockObservationDomain(database, identity) }
  );
}

function requireTrackedObservation(
  database: Prisma.TransactionClient,
  operation: SottoJobExecutionOperation,
  expected: { parentId: string; fingerprint: string }
) {
  const binding = assertSottoExecutionOperation(operation, expected);
  const tracked = trackedTransactions.get(database);
  if (!tracked || tracked.closing || !isDeepStrictEqual(tracked.binding, binding))
    throw new AssessmentFenceConflict();
  return binding;
}

/** Keep transaction-local work from escaping the tracked commit. */
export function trackAssessmentAudioObservationOperation<Result>(
  database: Prisma.TransactionClient,
  operation: SottoJobExecutionOperation,
  expected: { parentId: string; fingerprint: string },
  run: () => Promise<Result>
) {
  requireTrackedObservation(database, operation, expected);
  const tracked = trackedTransactions.get(database)!;
  if (tracked.actions !== 0) throw new AssessmentFenceConflict();
  tracked.actions += 1;
  const result = Promise.resolve().then(run);
  const settled = result
    .then(
      (value) => {
        tracked.result = value;
      },
      () => {
        tracked.failed = true;
      }
    )
    .finally(() => tracked.pending.delete(settled));
  tracked.pending.add(settled);
  return result.then(
    async (value) => {
      await settled;
      return value;
    },
    async (error: unknown) => {
      await settled;
      throw error;
    }
  );
}

function prefix(classId: string, generation: number) {
  const digest = createHash('sha256')
    .update(JSON.stringify([classId, generation]))
    .digest('hex');
  return `${SIDEDOOR_STATE_ID}:assessment-audio-claim:${digest}:`;
}

function backend(database: Prisma.TransactionClient, identity: Identity) {
  return sqlStateBackend(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    `${prefix(identity.classId, identity.classGeneration)}${identity.operationId}`
  );
}

/** Serialize observation and attempt transitions using the assessment row version. */
export async function fenceAssessmentAudioTransition(
  database: Prisma.TransactionClient,
  assessmentId: string
) {
  const count =
    await database.$executeRaw`UPDATE "ClassAssessment" SET "updatedAt" = "updatedAt" WHERE id = ${assessmentId}`;
  if (count !== 1) throw new AssessmentFenceConflict();
}

export async function assertAssessmentAudioUnclaimed(
  database: Prisma.TransactionClient,
  input: Identity
) {
  const identity = identitySchema.parse(input);
  const row = await backend(database, identity).read();
  if (!row) return;
  const claim = claimSchema.parse(row.state);
  if (
    !isDeepStrictEqual(identitySchema.strip().parse(claim), identity) ||
    claim.status === 'CLAIMED' ||
    (await sottoJobExecutions(database).read(claim.execution)).status !== 'settled'
  )
    throw new AssessmentFenceConflict();
}

/** Settlement must hold the exact unreleased claim for this child. */
export async function requireAssessmentAudioObservation(
  database: Prisma.TransactionClient,
  input: Identity & { nonce: string },
  operation: SottoJobExecutionOperation
) {
  const identity = identitySchema.strip().parse(input);
  const expected = { parentId: identity.operationId, fingerprint: identity.fingerprint };
  const binding = requireTrackedObservation(database, operation, expected);
  await lockObservationDomain(database, identity);
  await verifySottoExecutionOperation(database, operation, expected);
  const row = await backend(database, identity).read();
  const claim = row && claimSchema.parse(row.state);
  if (
    !claim ||
    !isDeepStrictEqual(identitySchema.strip().parse(claim), identity) ||
    !isDeepStrictEqual(claim.execution, binding) ||
    claim.status !== 'CLAIMED' ||
    claim.nonce !== input.nonce
  )
    throw new AssessmentFenceConflict();
  const executions = sottoJobExecutions(database);
  if (
    claim.execution.parentId !== identity.operationId ||
    claim.execution.fingerprint !== identity.fingerprint ||
    (await executions.read(claim.execution)).status !== 'active' ||
    (await executions.blockingStatus(identity.operationId, identity.fingerprint)) !== 'active'
  )
    throw new AssessmentFenceConflict();
}

async function lockObservationDomain(database: Prisma.TransactionClient, identity: Identity) {
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment audio observation requires a Serializable transaction');
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${identity.classId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${identity.assessmentId} FOR UPDATE`;
  const assessment = await database.classAssessment.findUnique({
    where: { id: identity.assessmentId },
    select: { classId: true, class: { select: { createdAt: true } } },
  });
  if (
    assessment?.classId !== identity.classId ||
    assessment.class.createdAt.getTime() !== identity.classGeneration
  )
    throw new AssessmentFenceConflict();
  const record = await sottoJobOutbox(database).read(identity.operationId);
  if (
    !record ||
    record.complete ||
    record.fingerprint !== identity.fingerprint ||
    record.job.handler !== 'audio-generation' ||
    record.job.version !== 1 ||
    !record.job.scopes.some(
      (scope) =>
        scope.subjectId === `class:${identity.classId}` &&
        scope.generation === identity.classGeneration
    )
  )
    throw new AssessmentFenceConflict();
  const envelope = durableEnvelopeSchema.parse(record.job.payload);
  const payload = z
    .object({
      episodeId: z.string().min(1),
      segmentId: z.string().min(1),
      segmentVersion: z.number().int().positive(),
      audioGenerationKey: z.string().min(1),
    })
    .passthrough()
    .parse(envelope.payload);
  if (
    envelope.type !== 'generate_audio' ||
    envelope.authority.kind !== 'episode' ||
    envelope.authority.episodeId !== payload.episodeId ||
    envelope.authority.preparationAudioGenerationKey !== payload.audioGenerationKey ||
    identity.operationId !==
      durableQueueOperationId(
        'audio-generation',
        `audio-${payload.episodeId}-${payload.segmentId}-v${payload.segmentVersion}-${payload.audioGenerationKey}`
      )
  )
    throw new AssessmentFenceConflict();
  const { readAssessmentAudioSettlementLineage } = await import('./assessment-audio-lineage');
  const { lineage, current } = await readAssessmentAudioSettlementLineage(
    database,
    payload.episodeId,
    payload.audioGenerationKey
  );
  const storage = z
    .object({
      scopes: z.array(
        z
          .object({
            subjectId: z.string().min(1),
            generation: z.number().int().nonnegative().safe(),
          })
          .strict()
      ),
    })
    .passthrough()
    .parse(lineage.storage);
  if (
    current.assessmentId !== identity.assessmentId ||
    current.classId !== identity.classId ||
    !isDeepStrictEqual(record.job.scopes, storage.scopes)
  )
    throw new AssessmentFenceConflict();
}

/** Claim an exact child under its real live execution and workspace. */
export async function claimAssessmentAudioObservation(
  database: Prisma.TransactionClient,
  input: Identity,
  operation: SottoJobExecutionOperation
) {
  const identity = identitySchema.parse(input);
  return trackAssessmentAudioObservationOperation(
    database,
    operation,
    { parentId: identity.operationId, fingerprint: identity.fingerprint },
    () => claimObservation(database, identity, operation)
  );
}

async function claimObservation(
  database: Prisma.TransactionClient,
  input: Identity,
  operation: SottoJobExecutionOperation
) {
  const identity = identitySchema.parse(input);
  const expected = { parentId: identity.operationId, fingerprint: identity.fingerprint };
  const binding = requireTrackedObservation(database, operation, expected);
  await lockObservationDomain(database, identity);
  await verifySottoExecutionOperation(database, operation, expected);
  const executions = sottoJobExecutions(database);
  const store = backend(database, identity);
  const previous = await store.read();
  if (previous) {
    const existing = claimSchema.parse(previous.state);
    if (existing.status === 'CLAIMED' && isDeepStrictEqual(existing.execution, binding)) {
      if (!isDeepStrictEqual(identitySchema.strip().parse(existing), identity))
        throw new AssessmentFenceConflict();
      return existing;
    }
    if (
      !isDeepStrictEqual(identitySchema.strip().parse(existing), identity) ||
      existing.execution.parentId !== identity.operationId ||
      existing.execution.fingerprint !== identity.fingerprint ||
      (await executions.read(existing.execution)).status !== 'settled'
    )
      throw new AssessmentFenceConflict();
  }
  await fenceAssessmentAudioTransition(database, identity.assessmentId);
  const claim = claimSchema.parse({
    ...identity,
    nonce: randomUUID(),
    status: 'CLAIMED',
    execution: binding,
  });
  if (
    !(await store.compareAndSwap(previous?.revision ?? null, {
      revision: randomUUID(),
      state: claim,
    }))
  )
    throw new AssessmentFenceConflict();
  return claim;
}

/** Only the exact claimant may release its fence; elapsed time grants no authority. */
export async function releaseAssessmentAudioObservation(
  database: Prisma.TransactionClient,
  input: Identity & { nonce: string },
  operation: SottoJobExecutionOperation
) {
  const identity = identitySchema.strip().parse(input);
  return trackAssessmentAudioObservationOperation(
    database,
    operation,
    { parentId: identity.operationId, fingerprint: identity.fingerprint },
    () => releaseObservation(database, input, operation)
  );
}

/** Release as part of an already tracked atomic publication completion. */
export async function releaseAssessmentAudioObservationInTrackedOperation(
  database: Prisma.TransactionClient,
  input: Identity & { nonce: string },
  operation: SottoJobExecutionOperation
) {
  const expected = { parentId: input.operationId, fingerprint: input.fingerprint };
  requireTrackedObservation(database, operation, expected);
  if (trackedTransactions.get(database)?.actions !== 1) throw new AssessmentFenceConflict();
  return releaseObservation(database, input, operation);
}

async function releaseObservation(
  database: Prisma.TransactionClient,
  input: Identity & { nonce: string },
  operation: SottoJobExecutionOperation
) {
  const identity = identitySchema.strip().parse(input);
  const expected = { parentId: identity.operationId, fingerprint: identity.fingerprint };
  const binding = requireTrackedObservation(database, operation, expected);
  await lockObservationDomain(database, identity);
  await verifySottoExecutionOperation(database, operation, expected);
  const store = backend(database, identity);
  const previous = await store.read();
  const claim = previous && claimSchema.parse(previous.state);
  if (
    !claim ||
    !isDeepStrictEqual(identitySchema.strip().parse(claim), identity) ||
    !isDeepStrictEqual(claim.execution, binding) ||
    claim.nonce !== input.nonce
  )
    throw new AssessmentFenceConflict();
  const executions = sottoJobExecutions(database);
  if (
    claim.execution.parentId !== identity.operationId ||
    claim.execution.fingerprint !== identity.fingerprint ||
    (await executions.read(claim.execution)).status !== 'active' ||
    (await executions.blockingStatus(identity.operationId, identity.fingerprint)) !== 'active'
  )
    throw new AssessmentFenceConflict();
  if (claim.status === 'RELEASED')
    return Object.freeze({ nonce: claim.nonce, status: 'RELEASED' as const });
  await fenceAssessmentAudioTransition(database, identity.assessmentId);
  if (
    !(await store.compareAndSwap(previous.revision, {
      revision: randomUUID(),
      state: { ...claim, status: 'RELEASED' },
    }))
  )
    throw new AssessmentFenceConflict();
  return Object.freeze({ nonce: claim.nonce, status: 'RELEASED' as const });
}

/** Capture released observations only after the exact child execution has drained. */
export async function inspectReleasedAssessmentAudioClaims(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    classGeneration: number;
    attempts: readonly { operationId: string; fingerprint: string; assessmentId: string }[];
  }
) {
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
  const claimPrefix = prefix(input.classId, input.classGeneration);
  const states: Array<{ id: string; revision: string }> = [];
  let after: string | undefined;
  while (true) {
    const rows = await database.sidedoorState.findMany({
      where: { id: { startsWith: claimPrefix, ...(after ? { gt: after } : {}) } },
      orderBy: { id: 'asc' },
      take: 100,
    });
    for (const row of rows) {
      if (states.length >= 2000) throw new AssessmentFenceConflict();
      const claim = claimSchema.parse(row.state);
      const attempt = input.attempts.find((item) => item.operationId === claim.operationId);
      if (
        row.id !== `${claimPrefix}${claim.operationId}` ||
        claim.classId !== input.classId ||
        claim.classGeneration !== input.classGeneration ||
        claim.status !== 'RELEASED' ||
        !attempt ||
        attempt.fingerprint !== claim.fingerprint ||
        attempt.assessmentId !== claim.assessmentId ||
        claim.execution.parentId !== claim.operationId ||
        claim.execution.fingerprint !== claim.fingerprint
      )
        throw new AssessmentFenceConflict();
      const executions = sottoJobExecutions(database);
      const execution = await executions.read(claim.execution);
      if (execution.status !== 'settled' || execution.workspace !== undefined)
        throw new AssessmentFenceConflict();
      await executions.requireParentDrained(claim.operationId, claim.fingerprint);
      states.push({ id: row.id, revision: row.revision });
    }
    if (rows.length < 100) return states;
    const next = rows[rows.length - 1]!.id;
    if (after && next <= after) throw new AssessmentFenceConflict();
    after = next;
  }
}
