import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  PrerequisiteFenceConflict,
  prerequisiteFenceBackend,
  prerequisiteFenceStore,
  prerequisiteWorkSchema,
} from './lifecycle/prerequisite-fence';
import { storedPrerequisiteAddendumSchema } from './lifecycle/prerequisite-contract';
import { readPrerequisiteSource } from './content/prerequisite-source';
import { requireRetirablePrerequisite } from './lifecycle/prerequisite-retirement';
import { requireCompletePrerequisiteDirections } from './content/prerequisite-directions';

/** Read owned status and expose only content backed by its exact sealed receipt. */
export async function readPrerequisiteStatus(
  database: Prisma.TransactionClient,
  classId: string,
  userId: string
) {
  const source = await readPrerequisiteSource(database, classId, userId);
  const request = { sourceHash: source.sourceHash, snapshotHash: source.hash };
  const base = { request, ...source.source.course };
  const fence = (await prerequisiteFenceStore(prerequisiteFenceBackend(database, classId)).read())
    .current;
  if (!fence) {
    if (source.storedAddendum !== undefined) throw new PrerequisiteFenceConflict();
    return {
      status: source.canRepair ? ('AVAILABLE' as const) : ('UNAVAILABLE' as const),
      ...base,
    };
  }
  if (
    fence.classId !== classId ||
    fence.userId !== userId ||
    fence.courseId !== source.courseId ||
    !isDeepStrictEqual(fence.ownership, source.ownership)
  )
    throw new PrerequisiteFenceConflict();
  const record = await sottoJobOutbox(database).read(fence.id);
  if (
    !record ||
    record.job.handler !== 'interactions' ||
    record.job.version !== 5 ||
    !isDeepStrictEqual(prerequisiteWorkSchema.parse(record.job.payload).fence, {
      ...fence,
      status: 'QUEUED',
    }) ||
    !isDeepStrictEqual(record.job.scopes, fence.ownership.scopes)
  )
    throw new PrerequisiteFenceConflict();
  if (fence.status === 'UNRESOLVED') return { status: 'UNRESOLVED' as const, ...base };
  if (['QUEUED', 'RUNNING'].includes(fence.status)) {
    if (record.complete) throw new PrerequisiteFenceConflict();
    const blocking = await sottoJobExecutions(database).blockingStatus(
      fence.id,
      record.fingerprint
    );
    return {
      status: blocking && blocking !== 'active' ? ('UNRESOLVED' as const) : ('PENDING' as const),
      ...base,
    };
  }
  if (!record.complete) {
    if (fence.status !== 'COMPLETED') throw new PrerequisiteFenceConflict();
    return { status: 'PENDING' as const, recoverable: true, ...base };
  }
  const receipt = await requireRetirablePrerequisite(database, fence);
  if (receipt.status === 'FAILED')
    return {
      status: 'FAILED' as const,
      canRetry:
        source.canRepair &&
        (receipt.failure !== 'UNSAFE' || receipt.sourceHash !== source.sourceHash),
      ...(receipt.failure === 'UNSAFE' ? { failure: 'UNSAFE' as const } : {}),
      ...base,
    };
  const stored = storedPrerequisiteAddendumSchema.safeParse(source.storedAddendum);
  if (!stored.success) throw new PrerequisiteFenceConflict();
  if (stored.data.sourceHash !== source.sourceHash || stored.data.sourceHash !== receipt.sourceHash)
    return { status: 'STALE' as const, canRetry: source.canRepair, ...base };
  const hash = createHash('sha256').update(JSON.stringify(stored.data.content)).digest('hex');
  if (hash !== receipt.contentHash) throw new PrerequisiteFenceConflict();
  requireCompletePrerequisiteDirections(source.source, stored.data.content.directions);
  const acknowledgment = stored.data.acknowledgment;
  return {
    status: 'READY' as const,
    content: stored.data.content,
    receiptId: fence.id,
    acknowledged:
      acknowledgment?.userId === userId &&
      acknowledgment.sourceHash === source.sourceHash &&
      acknowledgment.contentHash === hash &&
      acknowledgment.receiptId === fence.id,
    ...base,
  };
}
