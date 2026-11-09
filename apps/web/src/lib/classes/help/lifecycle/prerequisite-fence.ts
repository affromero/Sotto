import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { delegationBindingSchema } from 'thesidedoor-core/runtime/delegation';
import { OptimisticStateStore, type AtomicStateBackend } from 'thesidedoor-core/storage/optimistic';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const prerequisiteFenceSchema = z
  .object({
    id: z.uuid(),
    classId: z.string().min(1),
    courseId: z.string().min(1),
    userId: z.string().min(1),
    ownership: z
      .object({
        instanceId: z.uuid(),
        userId: z.string().min(1),
        scopes: z
          .array(
            z
              .object({ subjectId: z.string().min(1), generation: z.number().int().nonnegative() })
              .strict()
          )
          .length(4),
      })
      .strict(),
    sourceHash: digest,
    snapshotHash: digest,
    selection: z
      .object({
        provider: z.string().min(1),
        model: z.string().min(1),
        endpoint: z.string().optional(),
        isolatedImage: z.string().optional(),
        credentialFingerprint: digest.nullable(),
        moderationCredentialFingerprint: digest.nullable(),
      })
      .strict(),
    grant: delegationBindingSchema,
    status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'UNRESOLVED']),
  })
  .strict()
  .refine(
    (value) =>
      value.userId === value.ownership.userId &&
      value.id === value.grant.id &&
      new Set(value.ownership.scopes.map((scope) => scope.subjectId)).size === 4 &&
      value.ownership.scopes.some(
        (scope) =>
          scope.subjectId === `instance:${value.ownership.instanceId}` && scope.generation === 0
      ) &&
      value.ownership.scopes.some((scope) => scope.subjectId === `profile:${value.userId}`) &&
      value.ownership.scopes.some((scope) => scope.subjectId === `course:${value.courseId}`) &&
      value.ownership.scopes.some((scope) => scope.subjectId === `class:${value.classId}`)
  );

export type PrerequisiteFence = z.infer<typeof prerequisiteFenceSchema>;
export const prerequisiteWorkSchema = z
  .object({ kind: z.literal('CLASS_PREREQUISITE'), fence: prerequisiteFenceSchema })
  .strict();

export class PrerequisiteFenceConflict extends Error {
  constructor() {
    super('A prerequisite request is already active or needs recovery.');
    this.name = 'PrerequisiteFenceConflict';
  }
}

/** The caller commits this store, provider grant and outbox in one transaction. */
export function prerequisiteFenceStore(backend: AtomicStateBackend) {
  return new OptimisticStateStore<{ current: PrerequisiteFence | null }>({
    backend,
    parse: (value) =>
      z.object({ current: prerequisiteFenceSchema.nullable() }).strict().parse(value),
    initial: () => ({ current: null }),
  });
}

/** Record admission in the transaction that creates its grant and outbox job. */
export async function recordPrerequisiteFence(
  backend: AtomicStateBackend,
  proposed: PrerequisiteFence,
  retired?: PrerequisiteFence
) {
  return prerequisiteFenceStore(backend).transact((state) => {
    if (retired) {
      if (
        !isDeepStrictEqual(state.current, retired) ||
        !['COMPLETED', 'FAILED'].includes(retired.status)
      )
        throw new PrerequisiteFenceConflict();
      state.current = prerequisiteFenceSchema.parse(proposed);
      if (state.current.status !== 'QUEUED' || state.current.id === retired.id)
        throw new PrerequisiteFenceConflict();
      return state.current;
    }
    const admitted = admitPrerequisiteFence(state.current, proposed);
    state.current = admitted;
    return admitted;
  });
}

export function prerequisiteFenceBackend(database: Prisma.TransactionClient, classId: string) {
  return sqlStateBackend(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    prerequisiteFenceStateId(classId)
  );
}

export function prerequisiteFenceStateId(classId: string) {
  return `${SIDEDOOR_STATE_ID}:prerequisite:${createHash('sha256').update(classId).digest('hex')}`;
}

/** A changed snapshot cannot bypass an existing operation, including uncertain work. */
export function admitPrerequisiteFence(
  current: PrerequisiteFence | null,
  proposed: PrerequisiteFence
) {
  const next = prerequisiteFenceSchema.parse(proposed);
  if (next.status !== 'QUEUED') throw new PrerequisiteFenceConflict();
  if (!current) return next;
  if (
    ['QUEUED', 'RUNNING'].includes(current.status) &&
    current.classId === next.classId &&
    current.courseId === next.courseId &&
    current.userId === next.userId &&
    current.sourceHash === next.sourceHash &&
    current.snapshotHash === next.snapshotHash &&
    isDeepStrictEqual(current.ownership, next.ownership) &&
    isDeepStrictEqual(current.selection, next.selection)
  )
    return current;
  throw new PrerequisiteFenceConflict();
}
