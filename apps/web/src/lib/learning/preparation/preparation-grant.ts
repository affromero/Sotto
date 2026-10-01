import { DelegationStore, type DelegationGrant } from 'thesidedoor-core/runtime/delegation';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { PreparationConflictError, type ClassPreparation } from '../../classes/preparation-state';

export function learningPreparationGrantSpec(
  operation: Pick<
    ClassPreparation,
    | 'id'
    | 'grant'
    | 'instanceId'
    | 'userId'
    | 'userCreatedAt'
    | 'courseId'
    | 'courseCreatedAt'
    | 'expiresAt'
    | 'maxProviderRequests'
  >,
  kind: 'class' | 'practice' | 'writing'
): DelegationGrant {
  return {
    id: operation.id,
    revision: operation.grant.revision,
    instanceId: operation.instanceId,
    subject: { id: `profile:${operation.userId}`, generation: operation.userCreatedAt },
    resource: { id: `course:${operation.courseId}`, generation: operation.courseCreatedAt },
    operationId: operation.id,
    action: `${kind}-parent-provider-request`,
    expiresAt: operation.expiresAt,
    maxRequests: operation.maxProviderRequests ?? 1000,
  };
}

/** The caller's Serializable transaction also owns operation/outbox changes. */
export function learningPreparationGrant(
  database: Prisma.TransactionClient,
  operation: Pick<ClassPreparation, 'id' | 'courseId' | 'userId'>,
  kind: 'class' | 'practice' | 'writing'
) {
  const captured = structuredClone(operation);
  return new DelegationStore({
    backend: sqlStateBackend(
      {
        query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      },
      'postgres',
      `${SIDEDOOR_STATE_ID}:${kind}-grant:${captured.id}`
    ),
    authorize: async ({ grant }) => {
      const ownership = await captureCourseStorage(database, captured.courseId);
      if (
        ownership.instanceId !== grant.instanceId ||
        ownership.userId !== captured.userId ||
        grant.subject.id !== `profile:${captured.userId}` ||
        grant.resource.id !== `course:${captured.courseId}` ||
        grant.operationId !== captured.id ||
        grant.action !== `${kind}-parent-provider-request` ||
        !ownership.scopes.some(
          (scope) =>
            scope.subjectId === grant.subject.id && scope.generation === grant.subject.generation
        ) ||
        !ownership.scopes.some(
          (scope) =>
            scope.subjectId === grant.resource.id && scope.generation === grant.resource.generation
        )
      )
        throw new PreparationConflictError('The preparation authority changed.');
    },
  });
}
