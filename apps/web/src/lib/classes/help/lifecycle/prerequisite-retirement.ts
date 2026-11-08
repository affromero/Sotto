import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { capturePrerequisiteOwnership } from './prerequisite-ownership';
import {
  PrerequisiteFenceConflict,
  prerequisiteWorkSchema,
  type PrerequisiteFence,
} from './prerequisite-fence';
import { prerequisiteOutcomeSchema } from './prerequisite-contract';

/** A new request can replace only a complete, known and drained prior operation. */
export async function requireRetirablePrerequisite(
  database: Prisma.TransactionClient,
  previous: PrerequisiteFence
) {
  if (!['COMPLETED', 'FAILED'].includes(previous.status)) throw new PrerequisiteFenceConflict();
  const record = await sottoJobOutbox(database).read(previous.id);
  if (
    !record ||
    !record.complete ||
    record.job.handler !== 'interactions' ||
    record.job.version !== 5
  )
    throw new PrerequisiteFenceConflict();
  const work = prerequisiteWorkSchema.parse(record.job.payload);
  if (
    !isDeepStrictEqual(work.fence, { ...previous, status: 'QUEUED' }) ||
    !isDeepStrictEqual(record.job.scopes, previous.ownership.scopes) ||
    !isDeepStrictEqual(
      await capturePrerequisiteOwnership(
        database,
        previous.classId,
        previous.courseId,
        previous.userId
      ),
      previous.ownership
    )
  )
    throw new PrerequisiteFenceConflict();
  const grant = await learningPreparationGrant(database, previous, 'prerequisite').read(
    previous.grant
  );
  if (
    grant.status !== (previous.status === 'COMPLETED' ? 'completed' : 'revoked') ||
    grant.attempts.some((attempt) => ['admitted', 'unknown'].includes(attempt.outcome))
  )
    throw new PrerequisiteFenceConflict();
  const page = await sottoJobSnapshot(database).read(previous.id, record.fingerprint, 0);
  if (page.pages !== 1 || page.next !== null || page.items.length !== 1)
    throw new PrerequisiteFenceConflict();
  const outcome = prerequisiteOutcomeSchema.parse(page.items[0]);
  if (
    outcome.sourceHash !== previous.sourceHash ||
    outcome.status !== (previous.status === 'COMPLETED' ? 'READY' : 'FAILED')
  )
    throw new PrerequisiteFenceConflict();
  await sottoJobExecutions(database).requireParentDrained(previous.id, record.fingerprint);
  return outcome;
}
