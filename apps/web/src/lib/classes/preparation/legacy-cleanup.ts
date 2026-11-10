import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { StorageCleanupJournal, StorageReferenceRegistry } from 'thesidedoor-core/storage';
import { z } from 'zod';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { classPreparationGrant } from '../preparation-grant';
import type { ClassPreparation } from '../preparation-state';
import { CLASS_PREPARATION_QUEUE, classPreparationPayload } from './runtime';

/** Prove that an old direct class removal left no attributable work or media. */
export async function isEmptyLegacyPreparationCleanup(
  database: Prisma.TransactionClient,
  operation: ClassPreparation
): Promise<boolean> {
  if (!operation.classId || operation.intent || operation.audioEpisodeIds.length) return false;
  if ((await classPreparationGrant(database, operation).read(operation.grant)).status !== 'revoked')
    return false;
  const job = await sottoJobOutbox(database).read(operation.id);
  const payload = classPreparationPayload.safeParse(job?.job.payload);
  const ownership = await captureCourseStorage(database, operation.courseId);
  if (
    !job ||
    job.job.namespace !== SIDEDOOR_STATE_ID ||
    job.job.handler !== CLASS_PREPARATION_QUEUE ||
    job.job.version !== 1 ||
    !payload.success ||
    payload.data.courseId !== operation.courseId ||
    payload.data.operationId !== operation.id ||
    ownership.scopes.length !== job.job.scopes.length ||
    ownership.scopes.some(
      (scope) =>
        !job.job.scopes.some(
          (saved) => saved.subjectId === scope.subjectId && saved.generation === scope.generation
        )
    )
  )
    return false;
  const executions = sottoJobExecutions(database);
  if (await executions.blockingStatus(operation.id, job.fingerprint)) return false;
  await executions.requireParentDrained(operation.id, job.fingerprint);
  if (
    await database.courseClass.findUnique({
      where: { id: operation.classId },
      select: { id: true },
    })
  )
    return false;
  if (
    await database.episode.findFirst({
      where: { userId: operation.userId, source: 'CLASS', classSection: null },
      select: { id: true },
    })
  )
    return false;
  const preparationId = `${SIDEDOOR_STATE_ID}:class-preparation:${createHash('sha256')
    .update(operation.courseId)
    .digest('hex')}`;
  const courseScope = `course:${operation.courseId}`;
  const rows = await database.$queryRaw<
    Array<{
      total: bigint;
      ambiguous: bigint;
      assets: bigint;
      retirements: bigint;
      manifests: bigint;
    }>
  >`
    SELECT count(*) AS total,
      count(*) FILTER (WHERE state->>'kind' = 'storage_asset') AS assets,
      count(*) FILTER (WHERE state->>'kind' = 'storage_reference_retirement') AS retirements,
      count(*) FILTER (WHERE state->>'kind' = 'storage_cleanup_manifest') AS manifests,
      count(*) FILTER (WHERE id <> ${preparationId} AND (
        position(${operation.classId} IN state::text) > 0 OR
        (state->>'kind' IN (
          'storage_asset', 'storage_reference_retirement', 'write',
          'storage_cleanup', 'storage_cleanup_manifest', 'storage_reference_allocation'
        ) AND position(${courseScope} IN state::text) > 0) OR
        (state->>'kind' = 'storage_asset' AND
          jsonb_typeof(state->'prepared'->'scopes') IS DISTINCT FROM 'array') OR
        (state->>'kind' = 'storage_reference_retirement' AND
          (state->'attribution' IS NULL OR state->'attribution' = 'null'::jsonb OR
           jsonb_typeof(state->'attribution'->'prepared'->'scopes') IS DISTINCT FROM 'array')) OR
        (state->>'kind' IN ('storage_reference_alias', 'storage_reference_allocation') AND
          NOT EXISTS (SELECT 1 FROM "SidedoorState" AS asset
            WHERE asset.state->>'kind' = 'storage_asset' AND
              asset.state->>'id' = bounded.state->>'assetId' AND
              asset.state->'prepared'->>'namespace' = bounded.state->>'namespace' AND
              ((bounded.state->>'kind' = 'storage_reference_alias' AND
                bounded.state->>'reference' = asset.state->'prepared'->>'reference') OR
               (bounded.state->>'kind' = 'storage_reference_allocation' AND
                bounded.state->>'operationId' = asset.state->'prepared'->>'operationId' AND
                jsonb_typeof(bounded.state->'claims') = 'array')))) OR
        (state->>'kind' = 'storage_cleanup_manifest' AND
          NOT EXISTS (SELECT 1 FROM "SidedoorState" AS parent
            WHERE parent.state->>'kind' = 'storage_cleanup' AND
              parent.state->>'id' = bounded.state->>'jobId' AND
              parent.state->>'namespace' = bounded.state->>'namespace')) OR
        (state->>'kind' IN ('write', 'storage_cleanup') AND state->>'subjectId' IS NULL) OR
        (state->>'kind' = 'storage_cleanup' AND
          (state->>'subjectId' = ${`profile:${operation.userId}`} OR
           state->>'subjectId' = ${`instance:${operation.instanceId}`}))
      )) AS ambiguous
    FROM (SELECT id, state FROM "SidedoorState" LIMIT 10001) AS bounded
  `;
  if (!rows[0] || rows[0].total > 10000n || rows[0].ambiguous !== 0n) return false;
  const references = new StorageReferenceRegistry(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  let cursor: string | null = null;
  let assets = 0;
  do {
    const page = await references.listAssets(cursor);
    assets += page.assets.length;
    if (
      page.assets.some((asset) =>
        asset.prepared.scopes.some((scope) => scope.subjectId === courseScope)
      )
    )
      return false;
    cursor = page.cursor;
  } while (cursor !== null && assets <= 10000);
  if (BigInt(assets) !== rows[0].assets) return false;
  cursor = null;
  let retirements = 0;
  do {
    const page = await references.listRetirements(cursor);
    retirements += page.retirements.length;
    if (
      page.retirements.some(
        (retirement) =>
          !retirement.attribution ||
          retirement.attribution.prepared.scopes.some((scope) => scope.subjectId === courseScope)
      )
    )
      return false;
    cursor = page.cursor;
  } while (cursor !== null && retirements <= 10000);
  if (BigInt(retirements) !== rows[0].retirements) return false;
  const parents = await database.$queryRaw<Array<{ id: string | null }>>`
    SELECT DISTINCT state->>'jobId' AS id FROM "SidedoorState"
    WHERE state->>'kind' = 'storage_cleanup_manifest' LIMIT 10001
  `;
  const journal = new StorageCleanupJournal(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  let manifests = 0;
  for (const parent of parents) {
    const id = z.uuid().safeParse(parent.id);
    if (!id.success) return false;
    const job = await journal.get(id.data);
    if (
      job.namespace !== SIDEDOOR_STATE_ID ||
      job.phase !== 'complete' ||
      job.unresolvedManifests !== 0 ||
      job.subjectId === courseScope ||
      job.subjectId === `class:${operation.classId}` ||
      job.subjectId === `profile:${operation.userId}` ||
      job.subjectId === `instance:${operation.instanceId}`
    )
      return false;
    let pageCursor: string | null = null;
    let count = 0;
    do {
      const page = await journal.listManifests(job.id, pageCursor);
      if (page.pages.some((manifest) => manifest.resolution === null)) return false;
      count += page.pages.length;
      pageCursor = page.cursor;
    } while (pageCursor !== null && count <= 10000);
    if (count !== job.manifestCount) return false;
    manifests += count;
  }
  return BigInt(manifests) === rows[0].manifests;
}
