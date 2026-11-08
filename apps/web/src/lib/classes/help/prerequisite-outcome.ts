import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { capturePrerequisiteOwnership } from './lifecycle/prerequisite-ownership';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  prerequisiteAddendumSchema,
  prerequisiteOutcomeSchema,
} from './lifecycle/prerequisite-contract';
import {
  prerequisiteDirectionBatches,
  prerequisiteProviderBudget,
} from './content/prerequisite-directions';
import {
  PrerequisiteFenceConflict,
  prerequisiteFenceBackend,
  prerequisiteFenceStore,
  prerequisiteWorkSchema,
  type PrerequisiteFence,
} from './lifecycle/prerequisite-fence';
import { publishPrerequisiteAddendumInTransaction } from './content/prerequisite-generation';
import { requirePrerequisiteSource } from './content/prerequisite-source';

type Identity = { id: string; fingerprint: string };

async function currentWork(database: Prisma.TransactionClient, identity: Identity) {
  const record = await sottoJobOutbox(database).read(identity.id);
  if (
    !record ||
    record.fingerprint !== identity.fingerprint ||
    record.job.handler !== 'interactions' ||
    record.job.version !== 5
  )
    throw new PrerequisiteFenceConflict();
  const { fence } = prerequisiteWorkSchema.parse(record.job.payload);
  if (
    fence.status !== 'QUEUED' ||
    fence.id !== identity.id ||
    !isDeepStrictEqual(record.job.scopes, fence.ownership.scopes)
  )
    throw new PrerequisiteFenceConflict();
  const current = (
    await prerequisiteFenceStore(prerequisiteFenceBackend(database, fence.classId)).read()
  ).current;
  if (!current || !isDeepStrictEqual({ ...current, status: 'QUEUED' }, fence))
    throw new PrerequisiteFenceConflict();
  return { record, fence, current };
}

function parentAttempt(record: Awaited<ReturnType<typeof currentWork>>['record']) {
  return {
    id: record.job.id,
    fingerprint: createHash('sha256').update(JSON.stringify(record.job.payload)).digest('hex'),
  };
}

async function setStatus(
  database: Prisma.TransactionClient,
  expected: PrerequisiteFence,
  status: PrerequisiteFence['status']
) {
  await prerequisiteFenceStore(prerequisiteFenceBackend(database, expected.classId)).transact(
    (state) => {
      if (!isDeepStrictEqual(state.current, expected)) throw new PrerequisiteFenceConflict();
      state.current = { ...expected, status };
    }
  );
}

/** Revalidate the immutable work, owner, source and active authority before dispatch. */
export async function requirePendingPrerequisiteWork(
  database: Prisma.TransactionClient,
  identity: Identity,
  status: 'QUEUED' | 'RUNNING'
) {
  const { record, current } = await currentWork(database, { ...identity });
  if (record.complete || current.status !== status) throw new PrerequisiteFenceConflict();
  const source = await requirePrerequisiteSource(
    database,
    {
      classId: current.classId,
      userId: current.userId,
      sourceHash: current.sourceHash,
      hash: current.snapshotHash,
    },
    current.ownership
  );
  if (!source.canRepair) throw new PrerequisiteFenceConflict();
  const authority = learningPreparationGrant(database, current, 'prerequisite');
  await authority.validate(current.grant);
  const grant = await authority.read(current.grant);
  if (
    grant.grant.maxRequests !==
    prerequisiteProviderBudget(prerequisiteDirectionBatches(source.source).length)
  )
    throw new PrerequisiteFenceConflict();
  return current;
}

export async function readPrerequisiteWorkStatus(
  database: Prisma.TransactionClient,
  identity: Identity
) {
  return (await currentWork(database, { ...identity })).current.status;
}

/** Commit parent request admission and the running fence before provider dispatch. */
export async function startPrerequisiteWork(
  database: Prisma.TransactionClient,
  identity: Identity
) {
  identity = { ...identity };
  const { record, current } = await currentWork(database, identity);
  await requirePendingPrerequisiteWork(database, identity, 'QUEUED');
  const result = await learningPreparationGrant(database, current, 'prerequisite').admit(
    current.grant,
    parentAttempt(record)
  );
  if (!result.dispatch) throw new PrerequisiteFenceConflict();
  await setStatus(database, current, 'RUNNING');
}

/** Persist publication, authority settlement, receipt and fence atomically. */
export async function publishPrerequisiteOutcome(
  database: Prisma.TransactionClient,
  identity: Identity,
  execution: SottoProviderExecution,
  content: z.infer<typeof prerequisiteAddendumSchema>
) {
  identity = { ...identity };
  execution = { ...execution };
  const parsed = prerequisiteAddendumSchema.parse(structuredClone(content));
  const serialized = JSON.stringify(parsed);
  const { record, fence, current } = await currentWork(database, identity);
  if (record.complete || current.status !== 'RUNNING') throw new PrerequisiteFenceConflict();
  if (JSON.stringify(content) !== serialized) throw new PrerequisiteFenceConflict();
  await publishPrerequisiteAddendumInTransaction(
    database,
    {
      classId: fence.classId,
      userId: fence.userId,
      sourceHash: fence.sourceHash,
      hash: fence.snapshotHash,
      ownership: fence.ownership,
    },
    execution,
    content
  );
  const grant = learningPreparationGrant(database, fence, 'prerequisite');
  await grant.settle(fence.grant, parentAttempt(record), 'succeeded');
  await grant.complete(fence.grant);
  const snapshot = sottoJobSnapshot(database);
  await snapshot.createForJob(identity);
  await snapshot.append(identity.id, identity.fingerprint, 0, [
    prerequisiteOutcomeSchema.parse({
      status: 'READY',
      sourceHash: fence.sourceHash,
      contentHash: createHash('sha256').update(serialized).digest('hex'),
    }),
  ]);
  await snapshot.seal(identity.id, identity.fingerprint);
  await setStatus(database, current, 'COMPLETED');
}

/** A retained result permits acknowledging delivery only after execution drains. */
export async function recoverPrerequisiteOutcome(
  database: Prisma.TransactionClient,
  identity: Identity
) {
  identity = { ...identity };
  const { record, fence, current } = await currentWork(database, identity);
  if (current.status !== 'COMPLETED') return false;
  const ownership = await capturePrerequisiteOwnership(
    database,
    fence.classId,
    fence.courseId,
    fence.userId
  );
  if (!isDeepStrictEqual(ownership, fence.ownership)) throw new PrerequisiteFenceConflict();
  const grant = await learningPreparationGrant(database, fence, 'prerequisite').read(fence.grant);
  if (grant.status !== 'completed') throw new PrerequisiteFenceConflict();
  const page = await sottoJobSnapshot(database).read(identity.id, identity.fingerprint, 0);
  if (page.pages !== 1 || page.next !== null || page.items.length !== 1)
    throw new PrerequisiteFenceConflict();
  const outcome = prerequisiteOutcomeSchema.parse(page.items[0]);
  if (outcome.status !== 'READY' || outcome.sourceHash !== fence.sourceHash)
    throw new PrerequisiteFenceConflict();
  await sottoJobExecutions(database).requireParentDrained(identity.id, identity.fingerprint);
  if (!record.complete) await sottoJobOutbox(database).complete(identity.id, identity.fingerprint);
  return true;
}

/** Source changes never prevent retaining an uncertain provider outcome. */
export async function failPrerequisiteWork(
  database: Prisma.TransactionClient,
  identity: Identity,
  cleanupUnconfirmed: boolean,
  failure: 'UNSAFE' | 'FAILED' = 'FAILED'
) {
  identity = { ...identity };
  const { record, fence, current } = await currentWork(database, identity);
  if (record.complete || !['QUEUED', 'RUNNING'].includes(current.status))
    throw new PrerequisiteFenceConflict();
  const grant = learningPreparationGrant(database, fence, 'prerequisite');
  const authority = await grant.read(fence.grant);
  const attempt = parentAttempt(record);
  const blocked = await sottoJobExecutions(database).blockingStatus(
    identity.id,
    identity.fingerprint
  );
  const uncertain =
    cleanupUnconfirmed ||
    Boolean(blocked) ||
    authority.attempts.some(
      (item) => item.id !== attempt.id && ['admitted', 'unknown'].includes(item.outcome)
    );
  if (current.status === 'RUNNING')
    await grant.settle(fence.grant, attempt, uncertain ? 'unknown' : 'failed');
  await grant.revoke(fence.grant);
  if (uncertain) {
    await setStatus(database, current, 'UNRESOLVED');
    return 'UNRESOLVED' as const;
  }
  await sottoJobExecutions(database).requireParentDrained(identity.id, identity.fingerprint);
  const snapshot = sottoJobSnapshot(database);
  await snapshot.createForJob(identity);
  await snapshot.append(identity.id, identity.fingerprint, 0, [
    { status: 'FAILED', sourceHash: fence.sourceHash, failure },
  ]);
  await snapshot.seal(identity.id, identity.fingerprint);
  await setStatus(database, current, 'FAILED');
  await sottoJobOutbox(database).complete(identity.id, identity.fingerprint);
  return 'FAILED' as const;
}
