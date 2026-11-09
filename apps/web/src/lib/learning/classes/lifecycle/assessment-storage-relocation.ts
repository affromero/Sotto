import { isDeepStrictEqual } from 'node:util';
import { StorageInstanceControl } from 'thesidedoor-core/storage/instance';
import type { Prisma } from '@/generated/prisma/client';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import type { StorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import { resolveLockedPublishedStorageReference } from '@/lib/sidedoor/storage/migration/storage-publication';

/** Lock the supported ownership lifecycle and verify an unchanged or relocated asset. */
export async function resolveOwnedClassStorage(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    courseId: string;
    userId: string;
    original: StorageInput;
    currentReference: string;
    episodeId?: string;
  }
) {
  const rows = await database.$queryRaw<{ id: string }[]>`
    SELECT c.id FROM "CourseClass" c
    JOIN "Course" o ON o.id = c."courseId"
    JOIN "User" u ON u.id = o."userId"
    WHERE c.id = ${input.classId} AND o.id = ${input.courseId} AND u.id = ${input.userId}
    FOR UPDATE OF c FOR SHARE OF o, u`;
  if (rows.length !== 1) return null;
  const pointRead = 'SELECT "revision", "state" FROM "SidedoorState" WHERE "id" = $1';
  const instance = await new StorageInstanceControl(
    {
      query: (sql, values) => {
        if (sql !== pointRead || values.length !== 1 || typeof values[0] !== 'string')
          throw new Error('Assessment storage used an unsupported instance query');
        return database.$queryRawUnsafe<Record<string, unknown>[]>(`${sql} FOR SHARE`, ...values);
      },
    },
    'postgres',
    SIDEDOOR_STATE_ID
  ).read();
  const ownership = await capturePrerequisiteOwnership(
    database,
    input.classId,
    input.courseId,
    input.userId
  );
  if (instance.instanceId !== ownership.instanceId) return null;
  const allowedScopes = [...ownership.scopes];
  if (input.episodeId) {
    const episodes = await database.$queryRaw<{ id: string; createdAt: Date }[]>`
      SELECT id, "createdAt" FROM "Episode"
      WHERE id = ${input.episodeId} AND "userId" = ${input.userId} FOR UPDATE`;
    if (episodes.length !== 1) return null;
    allowedScopes.push({
      subjectId: `episode:${episodes[0]!.id}`,
      generation: episodes[0]!.createdAt.getTime(),
    });
  }
  const proof = await resolveLockedPublishedStorageReference(database, {
    consumer: input.original.consumer,
    originalReference: input.original.reference,
    currentReference: input.currentReference,
  });
  if (
    !proof ||
    proof.originalAssetId !== input.original.assetId ||
    !isDeepStrictEqual(proof.original.target, {
      backendId: input.original.backendId,
      binding: input.original.binding,
      key: input.original.key,
    }) ||
    (input.original.reference !== input.currentReference && proof.content === null) ||
    [...proof.original.scopes, ...proof.current.prepared.scopes].some(
      (scope) => !allowedScopes.some((owned) => isDeepStrictEqual(scope, owned))
    )
  )
    return null;
  return proof;
}
