import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { delegationGrantBinding } from 'thesidedoor-core/runtime/delegation';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import type { Prisma } from '@/generated/prisma/client';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  admitPrerequisiteFence,
  PrerequisiteFenceConflict,
  prerequisiteFenceBackend,
  prerequisiteFenceSchema,
  prerequisiteFenceStore,
  prerequisiteWorkSchema,
  recordPrerequisiteFence,
} from './prerequisite-fence';
import { readPrerequisiteSource } from '../content/prerequisite-source';
import { requireRetirablePrerequisite } from './prerequisite-retirement';
import {
  preflightPrerequisiteDirections,
  prerequisiteProviderBudget,
} from '../content/prerequisite-directions';
import {
  requireModeratedPrerequisitePayload,
  requirePrerequisiteBaseCapacity,
} from '../content/prerequisite-json';

export { prerequisiteWorkSchema } from './prerequisite-fence';

/** Called inside the serializable transaction that authenticates the request. */
export async function admitPrerequisiteWork(
  database: Prisma.TransactionClient,
  input: {
    id: string;
    revision: string;
    classId: string;
    userId: string;
    expiresAt: number;
    selection: z.infer<typeof prerequisiteFenceSchema>['selection'];
    authorize: (database: Prisma.TransactionClient) => Promise<{ userId: string }>;
  }
) {
  input = { ...input, selection: structuredClone(input.selection) };
  const actor = await input.authorize(database);
  if (actor.userId !== input.userId) throw new PrerequisiteFenceConflict();
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
  const source = await readPrerequisiteSource(database, input.classId, input.userId);
  if (!source.canRepair) throw new PrerequisiteFenceConflict();
  const basePayload = requireModeratedPrerequisitePayload(
    JSON.stringify({ source: source.source })
  );
  requirePrerequisiteBaseCapacity(basePayload);
  const batches = preflightPrerequisiteDirections(source.source);
  const subject = source.ownership.scopes.find(
    (scope) => scope.subjectId === `profile:${input.userId}`
  );
  const resource = source.ownership.scopes.find(
    (scope) => scope.subjectId === `course:${source.courseId}`
  );
  if (!subject || !resource) throw new PrerequisiteFenceConflict();
  const spec = {
    id: input.id,
    revision: input.revision,
    instanceId: source.ownership.instanceId,
    subject: { id: subject.subjectId, generation: subject.generation },
    resource: { id: resource.subjectId, generation: resource.generation },
    operationId: input.id,
    action: 'prerequisite-parent-provider-request',
    expiresAt: input.expiresAt,
    maxRequests: prerequisiteProviderBudget(batches.length),
  };
  const proposed = prerequisiteFenceSchema.parse({
    id: input.id,
    classId: input.classId,
    courseId: source.courseId,
    userId: input.userId,
    ownership: source.ownership,
    sourceHash: source.sourceHash,
    snapshotHash: source.hash,
    selection: input.selection,
    grant: delegationGrantBinding(spec),
    status: 'QUEUED',
  });
  const backend = prerequisiteFenceBackend(database, input.classId);
  const current = (await prerequisiteFenceStore(backend).read()).current;
  const retired = current && ['COMPLETED', 'FAILED'].includes(current.status) ? current : undefined;
  if (retired) {
    const outcome = await requireRetirablePrerequisite(database, retired);
    if (
      outcome.status === 'FAILED' &&
      outcome.failure === 'UNSAFE' &&
      outcome.sourceHash === source.sourceHash
    )
      throw new PrerequisiteFenceConflict();
  }
  const admitted = admitPrerequisiteFence(retired ? null : current, proposed);
  const outbox = sottoJobOutbox(database);
  if (current && !retired) {
    const record = await outbox.read(admitted.id);
    const payload = record && prerequisiteWorkSchema.safeParse(record.job.payload);
    if (
      !record ||
      record.complete ||
      record.job.handler !== 'interactions' ||
      record.job.version !== 5 ||
      !payload ||
      !payload.success ||
      !isDeepStrictEqual(payload.data.fence, { ...admitted, status: 'QUEUED' }) ||
      !isDeepStrictEqual(record.job.scopes, admitted.ownership.scopes)
    )
      throw new PrerequisiteFenceConflict();
    await learningPreparationGrant(database, admitted, 'prerequisite').validate(admitted.grant);
    return record;
  }
  if (await outbox.read(input.id)) throw new PrerequisiteFenceConflict();
  const record = await outbox.enqueue(
    prepareJob({
      id: input.id,
      namespace: SIDEDOOR_STATE_ID,
      handler: 'interactions',
      version: 5,
      payload: { kind: 'CLASS_PREREQUISITE', fence: proposed },
      scopes: source.ownership.scopes,
      delivery: { attempts: 1, priority: 0, availableAt: 0 },
    })
  );
  const grant = learningPreparationGrant(database, proposed, 'prerequisite');
  await grant.create(spec);
  await grant.validate(proposed.grant);
  await recordPrerequisiteFence(backend, proposed, retired);
  return record;
}
