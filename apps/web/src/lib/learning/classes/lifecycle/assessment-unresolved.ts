import { isDeepStrictEqual } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { JobExecutionJournal, JobOutbox, type OutboxJob } from 'thesidedoor-core/runtime/outbox';
import { LocalStorageCleanup, recoverExecutionWorkspace } from 'thesidedoor-core/storage';
import type { Queue } from 'bullmq';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { snapshotFailedSottoDelivery, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  assertSottoExecutionOperation,
  assertSottoExecutionStopped,
  hasSottoExecutionFailure,
  isSottoExecutionUncertain,
  resolveSottoExecutionDirectory,
  runSottoExecutionOperation,
  sottoJobExecutions,
  type SottoJobExecutionCapability,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  assessmentFenceBackend,
  assessmentFenceStore,
  assessmentWorkSchema,
  AssessmentFenceConflict,
} from './assessment-fence';
import { assessmentYieldFailureIdentity } from '../generation/assessment-yield';

type Binding = ReturnType<typeof assertSottoExecutionOperation>;
type SettlementAuthority = object;
const authorities = new WeakMap<
  SettlementAuthority,
  { binding: Binding; capability: SottoJobExecutionCapability }
>();
const gateSchema = z
  .object({ id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), settled: z.boolean() })
  .strict();
const pointRead = 'SELECT "revision", "state" FROM "SidedoorState" WHERE "id" = $1';
const assessmentCleanupPrefix = `${SIDEDOOR_STATE_ID}:assessment-cleanup:`;
const cleanupDigest = z.string().regex(/^[a-f0-9]{64}$/);
export const stoppedAssessmentProofSchema = z.strictObject({
  binding: z.strictObject({
    id: z.uuid(),
    parentId: z.uuid(),
    fingerprint: cleanupDigest,
    executorId: z.uuid(),
  }),
  assessmentId: z.string().min(1),
  workspaceSha256: cleanupDigest,
  delivery: z.strictObject({
    operationId: z.uuid(),
    fingerprint: cleanupDigest,
    deliveryAttempts: z.number().int().positive(),
    failedAt: z.number().int().positive(),
    processedAt: z.number().int().positive(),
  }),
});
const workspaceDirectoryIdentity = z.strictObject({
  root: z.string(),
  device: z.string(),
  inode: z.string(),
  binding: z.string(),
});
const executionLocationMarker = z.strictObject({
  version: z.literal(1),
  locationId: z.uuid(),
  root: workspaceDirectoryIdentity,
});
const stoppedAssessmentReceiptSchema = stoppedAssessmentProofSchema
  .pick({ binding: true, delivery: true })
  .extend({
    workspace: z.strictObject({
      locationId: z.uuid(),
      executionId: z.uuid(),
      root: workspaceDirectoryIdentity,
      directory: workspaceDirectoryIdentity,
    }),
  });

export async function hasStoppedAssessmentCleanup(
  database: Prisma.TransactionClient,
  identity: { id: string; fingerprint: string },
  proof?: z.infer<typeof stoppedAssessmentProofSchema>
) {
  const receipts = await database.sidedoorState.findMany({
    where: {
      id: proof
        ? assessmentCleanupPrefix + proof.binding.id
        : { startsWith: assessmentCleanupPrefix },
      AND: [
        { state: { path: ['binding', 'parentId'], equals: identity.id } },
        { state: { path: ['binding', 'fingerprint'], equals: identity.fingerprint } },
      ],
    },
    take: 2,
  });
  const receipt = receipts[0];
  if (receipts.length !== 1 || !receipt) return false;
  const parsed = stoppedAssessmentReceiptSchema.safeParse(receipt.state);
  if (!parsed.success) return false;
  const binding = parsed.data.binding;
  if (
    receipt.id !== assessmentCleanupPrefix + binding.id ||
    binding.parentId !== identity.id ||
    binding.fingerprint !== identity.fingerprint ||
    parsed.data.workspace.executionId !== binding.id ||
    parsed.data.delivery.operationId !== identity.id ||
    parsed.data.delivery.fingerprint !== identity.fingerprint
  )
    return false;
  if (
    proof &&
    (!isDeepStrictEqual(binding, proof.binding) ||
      !isDeepStrictEqual(parsed.data.delivery, proof.delivery) ||
      createHash('sha256').update(JSON.stringify(parsed.data.workspace)).digest('hex') !==
        proof.workspaceSha256)
  )
    return false;
  const journal = sottoJobExecutions(database);
  if ((await journal.blockingStatus(identity.id, identity.fingerprint)) !== null) return false;
  return (await journal.read(binding)).status === 'settled';
}

/** Capture the SDK gate revision so a later execution invalidates an old queue observation. */
export async function observeExecutionGate(
  database: Prisma.TransactionClient,
  identity: { id: string; fingerprint: string }
) {
  let revision: string | null | undefined;
  const journal = new JobExecutionJournal(
    {
      query: async (sql, values) => {
        if (sql !== pointRead || values.length !== 1 || typeof values[0] !== 'string')
          throw new Error('Assessment gate used an unsupported journal query');
        const rows = await database.$queryRawUnsafe<{ revision: string; state: unknown }[]>(
          sql,
          ...values
        );
        if (revision === undefined) {
          if (!/^sd-jeg:1:[a-f0-9]{64}:[0-9a-f-]{36}$/.test(values[0]))
            throw new Error('Assessment gate used an unsupported journal key');
          revision = rows[0]?.revision ?? null;
        }
        return rows;
      },
    },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  const blocking = await journal.blockingStatus(identity.id, identity.fingerprint);
  if (revision === undefined) throw new Error('Assessment gate was not observed');
  return { revision, blocking };
}

/** Fence an expired grant after its parent execution has drained, preserving descendants. */
export async function markExpiredAssessmentUnresolved(
  database: Prisma.TransactionClient,
  identity: { id: string; fingerprint: string }
) {
  const outcome = await markWithoutExecutor(database, identity, { kind: 'expired' });
  if (outcome === 'WAITING') throw new AssessmentFenceConflict();
  return outcome === 'UNRESOLVED';
}

/** A terminal Redis observation is historical evidence, not proof of provider settlement. */
export async function reconcileFailedAssessmentDelivery(input: {
  database: PrismaClient;
  queue: Queue;
  identity: { id: string; fingerprint: string };
  signal: AbortSignal;
}) {
  if (input.queue.name !== 'interactions') throw new AssessmentFenceConflict();
  const observed = await sottoTransaction(
    input.database,
    async (database) => ({
      record: await sottoJobOutbox(database).read(input.identity.id),
      gate: await observeExecutionGate(database, input.identity),
    }),
    { signal: input.signal }
  );
  const { record, gate } = observed;
  if (
    !record ||
    record.complete ||
    record.fingerprint !== input.identity.fingerprint ||
    record.job.handler !== 'interactions' ||
    record.job.version !== 6
  )
    throw new AssessmentFenceConflict();
  if (gate.blocking) return 'WAITING' as const;
  await snapshotFailedSottoDelivery(input.queue, record);
  input.signal.throwIfAborted();
  return sottoTransaction(
    input.database,
    (database) =>
      markWithoutExecutor(database, input.identity, {
        kind: 'terminal',
        record,
        gateRevision: gate.revision,
      }),
    { signal: input.signal }
  );
}

async function markWithoutExecutor(
  database: Prisma.TransactionClient,
  identity: { id: string; fingerprint: string },
  reason: { kind: 'expired' } | { kind: 'terminal'; record: OutboxJob; gateRevision: string | null }
) {
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment expiry requires a Serializable transaction');
  const outbox = sottoJobOutbox(database);
  const record = await outbox.read(identity.id);
  if (
    !record ||
    record.complete ||
    record.fingerprint !== identity.fingerprint ||
    record.job.handler !== 'interactions' ||
    record.job.version !== 6
  )
    throw new AssessmentFenceConflict();
  const { fence } = assessmentWorkSchema.parse(record.job.payload);
  if (
    fence.id !== identity.id ||
    fence.status !== 'QUEUED' ||
    !isDeepStrictEqual(record.job.scopes, fence.ownership.scopes)
  )
    throw new AssessmentFenceConflict();
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${fence.classId} FOR UPDATE`;
  const touched =
    await database.$executeRaw`UPDATE "ClassAssessment" SET "updatedAt" = "updatedAt" WHERE id = ${fence.assessmentId}`;
  if (touched !== 1) throw new AssessmentFenceConflict();
  const current = (
    await assessmentFenceStore(assessmentFenceBackend(database, fence.classId)).read()
  ).current;
  if (
    !current ||
    !['QUEUED', 'RUNNING', 'UNRESOLVED'].includes(current.status) ||
    !isDeepStrictEqual({ ...current, status: 'QUEUED' }, fence)
  )
    throw new AssessmentFenceConflict();
  const assessment = await database.classAssessment.findUnique({
    where: { id: fence.assessmentId },
  });
  if (
    !assessment ||
    assessment.classId !== fence.classId ||
    assessment.courseId !== fence.courseId ||
    assessment.userId !== fence.userId ||
    assessment.classAttempt !== fence.classAttempt ||
    assessment.assessmentAttempt !== fence.assessmentAttempt ||
    assessment.materialVersion !== (fence.materialVersion ?? 1) ||
    assessment.generationOperationId !== identity.id ||
    assessment.sealedAt !== null ||
    assessment.status !== (current.status === 'UNRESOLVED' ? 'UNRESOLVED' : 'GENERATING') ||
    !isDeepStrictEqual(
      await capturePrerequisiteOwnership(database, fence.classId, fence.courseId, fence.userId),
      fence.ownership
    )
  )
    throw new AssessmentFenceConflict();
  const grant = learningPreparationGrant(database, current, 'assessment');
  const authority = await grant.read(current.grant);
  const now = Date.now();
  if (reason.kind === 'expired' && now < authority.grant.expiresAt) return 'NOT_EXPIRED' as const;
  if (current.status === 'UNRESOLVED' && authority.status === 'revoked')
    return 'UNRESOLVED' as const;
  if (authority.status !== 'active') throw new AssessmentFenceConflict();
  const parent = authority.attempts.find((attempt) => attempt.id === identity.id);
  const parentFingerprint = createHash('sha256')
    .update(JSON.stringify(record.job.payload))
    .digest('hex');
  if (
    (current.status === 'QUEUED' && authority.attempts.length !== 0) ||
    (current.status === 'RUNNING' &&
      (!parent ||
        parent.fingerprint !== parentFingerprint ||
        !['admitted', 'unknown'].includes(parent.outcome))) ||
    (current.status === 'UNRESOLVED' &&
      (parent
        ? parent.fingerprint !== parentFingerprint ||
          !['admitted', 'unknown'].includes(parent.outcome)
        : authority.attempts.length !== 0))
  )
    throw new AssessmentFenceConflict();
  const executions = sottoJobExecutions(database);
  const observedGate = await observeExecutionGate(database, identity);
  if (reason.kind === 'terminal' && observedGate.revision !== reason.gateRevision)
    throw new AssessmentFenceConflict();
  if (observedGate.blocking) return 'WAITING' as const;
  await executions.requireParentDrained(identity.id, identity.fingerprint);
  const lockedOutbox = new JobOutbox(
    {
      query: (sql, values) => {
        if (!sql.startsWith('SELECT ')) throw new Error('Expected an outbox read');
        return database.$queryRawUnsafe<Record<string, unknown>[]>(`${sql} FOR UPDATE`, ...values);
      },
    },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  const locked = await lockedOutbox.read(identity.id);
  if (
    !locked ||
    !isDeepStrictEqual(locked, record) ||
    (reason.kind === 'terminal' && !isDeepStrictEqual(locked, reason.record))
  )
    throw new AssessmentFenceConflict();
  await grant.revoke(current.grant);
  if (current.status === 'UNRESOLVED') return 'UNRESOLVED' as const;
  const changed = await database.classAssessment.updateMany({
    where: { id: fence.assessmentId, status: 'GENERATING', sealedAt: null },
    data: { status: 'UNRESOLVED' },
  });
  if (changed.count !== 1) throw new AssessmentFenceConflict();
  await assessmentFenceStore(assessmentFenceBackend(database, fence.classId)).transact((state) => {
    if (!isDeepStrictEqual(state.current, current)) throw new AssessmentFenceConflict();
    state.current = { ...current, status: 'UNRESOLVED' };
  });
  return 'UNRESOLVED' as const;
}

/** Capture only from a live executor, before provider dispatch or cancellation. */
export function captureAssessmentSettlementAuthority(input: {
  identity: { id: string; fingerprint: string };
  capability: SottoJobExecutionCapability;
}) {
  const identity = { ...input.identity };
  return runSottoExecutionOperation(
    input.capability,
    { parentId: identity.id, fingerprint: identity.fingerprint },
    async (operation) => {
      const binding = assertSottoExecutionOperation(operation, {
        parentId: identity.id,
        fingerprint: identity.fingerprint,
      });
      const authority = Object.freeze({});
      authorities.set(authority, { binding, capability: input.capability });
      return authority;
    }
  );
}

/** A stopped failed or uncertain executor keeps its work fenced for recovery. */
export function markAssessmentUnresolved(input: {
  database: PrismaClient;
  authority: SettlementAuthority;
}) {
  const authority = authorities.get(input.authority);
  if (!authority) throw new AssessmentFenceConflict();
  assertSottoExecutionStopped(authority.capability);
  const mayNeedRecovery =
    isSottoExecutionUncertain(authority.capability) ||
    hasSottoExecutionFailure(authority.capability);
  const binding = { ...authority.binding };
  return sottoTransaction(
    input.database,
    (database) =>
      markInTransaction(
        database,
        { id: binding.parentId, fingerprint: binding.fingerprint },
        binding,
        mayNeedRecovery
      ),
    { signal: AbortSignal.timeout(30_000) }
  );
}

/** A failed queue transition can fence only the execution that attempted it. */
export function markFailedAssessmentYield(input: {
  database: PrismaClient;
  authority: SettlementAuthority;
  error: unknown;
}) {
  const authority = authorities.get(input.authority);
  const failure = assessmentYieldFailureIdentity(input.error);
  if (
    !authority ||
    !failure ||
    failure.authority !== input.authority ||
    failure.identity.id !== authority.binding.parentId ||
    failure.identity.fingerprint !== authority.binding.fingerprint
  )
    throw new AssessmentFenceConflict();
  assertSottoExecutionStopped(authority.capability);
  const binding = { ...authority.binding };
  return sottoTransaction(
    input.database,
    (database) =>
      markInTransaction(
        database,
        { id: binding.parentId, fingerprint: binding.fingerprint },
        binding,
        true
      ),
    { signal: AbortSignal.timeout(30_000) }
  );
}

async function lockExactExecution(database: Prisma.TransactionClient, binding: Binding) {
  let gate: z.infer<typeof gateSchema> | undefined;
  let gateReads = 0;
  const readIds: string[] = [];
  const journal = new JobExecutionJournal(
    {
      query: async (sql, values) => {
        if (sql !== pointRead || values.length !== 1 || typeof values[0] !== 'string')
          throw new Error('Assessment execution journal used an unsupported query');
        readIds.push(values[0]);
        const rows = await database.$queryRawUnsafe<Record<string, unknown>[]>(
          `${sql} FOR UPDATE`,
          ...values
        );
        if (rows.length !== 1) throw new AssessmentFenceConflict();
        const parsed = gateSchema.safeParse(rows[0]?.state);
        if (parsed.success) {
          gate = parsed.data;
          gateReads += 1;
        }
        return rows;
      },
    },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  const execution = await journal.read(binding);
  const blocking = await journal.blockingStatus(binding.parentId, binding.fingerprint);
  if (
    gateReads !== 1 ||
    !gate ||
    gate.id !== binding.id ||
    gate.fingerprint !== binding.fingerprint ||
    readIds[0] === readIds[1] ||
    (gate.settled
      ? readIds.length !== 2 || execution.status !== 'settled' || blocking !== null
      : readIds.length !== 3 || readIds[0] !== readIds[2] || execution.status !== blocking)
  )
    throw new AssessmentFenceConflict();
  return execution.status;
}

async function lockAssessmentSettlement(
  database: Prisma.TransactionClient,
  input: { id: string; fingerprint: string },
  binding: Binding
) {
  const identity = { ...input };
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment settlement requires a Serializable transaction');
  const record = await sottoJobOutbox(database).read(identity.id);
  if (
    !record ||
    record.fingerprint !== identity.fingerprint ||
    record.job.handler !== 'interactions' ||
    record.job.version !== 6
  )
    throw new AssessmentFenceConflict();
  const { fence } = assessmentWorkSchema.parse(record.job.payload);
  if (
    fence.id !== identity.id ||
    fence.status !== 'QUEUED' ||
    !isDeepStrictEqual(record.job.scopes, fence.ownership.scopes)
  )
    throw new AssessmentFenceConflict();
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${fence.classId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${fence.assessmentId} FOR UPDATE`;
  const executionStatus = await lockExactExecution(database, binding);
  const current = (
    await assessmentFenceStore(assessmentFenceBackend(database, fence.classId)).read()
  ).current;
  if (
    !current ||
    !['QUEUED', 'RUNNING', 'UNRESOLVED'].includes(current.status) ||
    !isDeepStrictEqual({ ...current, status: 'QUEUED' }, fence)
  )
    throw new AssessmentFenceConflict();
  const cls = await database.courseClass.findFirst({
    where: { id: fence.classId, courseId: fence.courseId, course: { userId: fence.userId } },
    select: { createdAt: true },
  });
  const classScope = fence.ownership.scopes.find(
    (scope) => scope.subjectId === `class:${fence.classId}`
  );
  const assessment = await database.classAssessment.findUnique({
    where: { id: fence.assessmentId },
  });
  if (
    !cls ||
    !classScope ||
    cls.createdAt.getTime() !== classScope.generation ||
    !assessment ||
    assessment.classId !== fence.classId ||
    assessment.courseId !== fence.courseId ||
    assessment.userId !== fence.userId ||
    assessment.classAttempt !== fence.classAttempt ||
    assessment.assessmentAttempt !== fence.assessmentAttempt ||
    assessment.materialVersion !== (fence.materialVersion ?? 1) ||
    assessment.generationOperationId !== identity.id ||
    assessment.sealedAt !== null ||
    assessment.status !== (current.status === 'UNRESOLVED' ? 'UNRESOLVED' : 'GENERATING')
  )
    throw new AssessmentFenceConflict();
  const grant = learningPreparationGrant(database, current, 'assessment');
  const authority = await grant.read(current.grant);
  return { record, current, fence, grant, authority, executionStatus };
}

async function markInTransaction(
  database: Prisma.TransactionClient,
  identity: { id: string; fingerprint: string },
  binding: Binding,
  mayNeedRecovery: boolean
) {
  const { record, current, fence, grant, authority, executionStatus } =
    await lockAssessmentSettlement(database, identity, binding);
  if (record.complete || (!mayNeedRecovery && executionStatus !== 'cleanup-unconfirmed'))
    throw new AssessmentFenceConflict();
  if (!['active', 'revoked'].includes(authority.status)) throw new AssessmentFenceConflict();
  await grant.revoke(current.grant);
  if (current.status !== 'UNRESOLVED') {
    const updated = await database.classAssessment.updateMany({
      where: { id: fence.assessmentId, status: 'GENERATING', sealedAt: null },
      data: { status: 'UNRESOLVED' },
    });
    if (updated.count !== 1) throw new AssessmentFenceConflict();
    await assessmentFenceStore(assessmentFenceBackend(database, fence.classId)).transact(
      (state) => {
        if (!isDeepStrictEqual(state.current, current)) throw new AssessmentFenceConflict();
        state.current = { ...current, status: 'UNRESOLVED' };
      }
    );
  }
  return { status: 'UNRESOLVED' as const };
}

async function verifyStoppedExecutionLocation(
  workspace: z.infer<typeof stoppedAssessmentReceiptSchema>['workspace']
) {
  const root = workspace.root.root;
  if ((await realpath(resolveSottoExecutionDirectory())) !== root)
    throw new AssessmentFenceConflict();
  await LocalStorageCleanup.restore(workspace.root);
  const directory = await lstat(root);
  if (!directory.isDirectory() || (directory.mode & 0o7777) !== 0o700)
    throw new AssessmentFenceConflict();

  const path = join(root, 'location.json');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat({ bigint: true });
    if (
      !info.isFile() ||
      (info.mode & 0o7777n) !== 0o600n ||
      info.nlink !== 1n ||
      info.uid !== BigInt(directory.uid) ||
      info.size < 1n ||
      info.size > 4096n
    )
      throw new AssessmentFenceConflict();
    const bytes = Buffer.alloc(Number(info.size) + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const current = await lstat(path, { bigint: true });
    if (
      BigInt(offset) !== info.size ||
      current.dev !== info.dev ||
      current.ino !== info.ino ||
      current.size !== info.size ||
      current.ctimeNs !== info.ctimeNs
    )
      throw new AssessmentFenceConflict();
    const location = executionLocationMarker.parse(
      JSON.parse(bytes.subarray(0, offset).toString())
    );
    if (
      location.locationId !== workspace.locationId ||
      !isDeepStrictEqual(location.root, workspace.root)
    )
      throw new AssessmentFenceConflict();
    await LocalStorageCleanup.restore(workspace.root);
  } finally {
    await file.close();
  }
}

/** Operator-only. Prove the original supervisor stopped and keep admissions fenced until completion. */
export async function recoverStoppedAssessmentExecution(input: {
  database: PrismaClient;
  queue: Queue;
  proof: z.infer<typeof stoppedAssessmentProofSchema>;
  verifyStopped: () => Promise<void>;
  removeEmptyWorkspace: (identity: string) => Promise<void>;
  signal: AbortSignal;
}) {
  if (input.queue.name !== 'interactions') throw new AssessmentFenceConflict();
  const proof = stoppedAssessmentProofSchema.parse(input.proof);
  const { binding } = proof;
  const identity = { id: binding.parentId, fingerprint: binding.fingerprint };
  const receiptId = assessmentCleanupPrefix + binding.id;

  async function read(database: Prisma.TransactionClient) {
    const { record, current, authority, executionStatus } = await lockAssessmentSettlement(
      database,
      identity,
      binding
    );
    if (
      current.status !== 'UNRESOLVED' ||
      current.assessmentId !== proof.assessmentId ||
      authority.status !== 'revoked' ||
      (record.complete ? executionStatus !== 'settled' : executionStatus !== 'cleanup-unconfirmed')
    )
      throw new AssessmentFenceConflict();
    return { record, execution: await sottoJobExecutions(database).read(binding) };
  }
  async function transaction<Result>(run: (database: Prisma.TransactionClient) => Promise<Result>) {
    await input.verifyStopped();
    return sottoTransaction(input.database, run, { signal: input.signal });
  }
  const captured = await transaction(read);
  if (captured.record.complete) {
    if (!(await transaction((database) => hasStoppedAssessmentCleanup(database, identity, proof))))
      throw new AssessmentFenceConflict();
    return { executionId: binding.id };
  }
  if (!(await input.queue.isPaused()) || (await input.queue.getWorkers()).length !== 0)
    throw new AssessmentFenceConflict();
  const workspace = captured.execution.workspace;
  if (!workspace || !('directory' in workspace)) throw new AssessmentFenceConflict();
  const workspaceIdentity = JSON.stringify(workspace);
  const workspaceHash = createHash('sha256').update(workspaceIdentity).digest('hex');
  if (workspaceHash !== proof.workspaceSha256) throw new AssessmentFenceConflict();
  // The stopped-writer fence permits reading the marker without a writable SDK guard.
  await verifyStoppedExecutionLocation(workspace);
  const delivery = await snapshotFailedSottoDelivery(input.queue, captured.record);
  if (!isDeepStrictEqual(delivery, proof.delivery)) throw new AssessmentFenceConflict();
  const expected = JSON.parse(
    JSON.stringify({ binding, workspace, delivery })
  ) as Prisma.InputJsonValue;
  const approved = await transaction((database) =>
    database.sidedoorState.findUnique({ where: { id: receiptId } })
  );
  if (approved && !isDeepStrictEqual(approved.state, expected)) throw new AssessmentFenceConflict();
  // The SDK validates the canonical path and both directory identities.
  const { directory, ...plan } = workspace;
  const inspectWorkspace = async () => {
    const present = await recoverExecutionWorkspace(plan, workspace.locationId);
    if (present && !isDeepStrictEqual(present, workspace)) throw new AssessmentFenceConflict();
    return present;
  };
  const present = await inspectWorkspace();
  if (!present && !approved) throw new AssessmentFenceConflict();
  if (present && (await readdir(directory.root)).length !== 0)
    throw new Error('Stopped assessment workspace must be empty');
  await transaction(async (database) => {
    if (!isDeepStrictEqual(await read(database), captured)) throw new AssessmentFenceConflict();
    const existing = await database.sidedoorState.findUnique({ where: { id: receiptId } });
    if (existing && !isDeepStrictEqual(existing.state, expected))
      throw new AssessmentFenceConflict();
    if (!existing)
      await database.sidedoorState.create({
        data: { id: receiptId, revision: randomUUID(), state: expected },
      });
  });
  input.signal.throwIfAborted();
  await input.verifyStopped();
  const current = await inspectWorkspace();
  if (Boolean(current) !== Boolean(present)) throw new AssessmentFenceConflict();
  if (current) {
    await input.removeEmptyWorkspace(workspaceIdentity);
    if (await inspectWorkspace()) throw new AssessmentFenceConflict();
  }
  if (
    !(await input.queue.isPaused()) ||
    (await input.queue.getWorkers()).length !== 0 ||
    !isDeepStrictEqual(await snapshotFailedSottoDelivery(input.queue, captured.record), delivery)
  )
    throw new AssessmentFenceConflict();
  await transaction(async (database) => {
    if (!isDeepStrictEqual(await read(database), captured)) throw new AssessmentFenceConflict();
    const journal = sottoJobExecutions(database);
    await journal.releaseWorkspace(binding, workspace);
    if (!(await sottoJobOutbox(database).complete(binding.parentId, binding.fingerprint)))
      throw new AssessmentFenceConflict();
    await journal.settle(binding);
  });
  return { executionId: binding.id };
}
