import { isDeepStrictEqual } from 'node:util';
import { StorageReferenceRegistry, type StorageSurvivorGraph } from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { isBundledAvatarImage } from '@/lib/avatars';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import type { prepareStorageCopiesForDeletion } from '../storage-migration-copy';
import { planStorageSurvivorProjection } from './projection';
import { requireAccountedRelocationReferences } from './retained-avatar';

/** Recheck and lock avatar ownership before changing shared relocation records. */
export async function verifyAvatarProjectionOwnership(
  database: Prisma.TransactionClient,
  graph: StorageSurvivorGraph,
  copies: Awaited<ReturnType<typeof prepareStorageCopiesForDeletion>>,
  subjects: readonly { subjectId: string; generation: number }[]
) {
  planStorageSurvivorProjection(graph, copies, subjects);
  const instance = await sottoStorageInstance(database).read();
  const assets = new Map(graph.assets.map((asset) => [asset.id, asset]));
  const consumers = new Map<string, string>();
  const paths = [...graph.paths].sort((left, right) =>
    left.consumer < right.consumer ? -1 : left.consumer > right.consumer ? 1 : 0
  );
  for (const path of paths) {
    if (!path.consumer.startsWith('profile:') || !path.consumer.endsWith(':avatar'))
      throw new Error('Storage survivor avatar ownership is not independently verified');
    const subjectId = path.consumer.slice(0, -':avatar'.length);
    const id = subjectId.slice('profile:'.length);
    const locked = await database.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
    if (locked.length !== 1) throw new Error('Storage survivor profile is missing');
    const profile = await database.user.findUnique({
      where: { id },
      select: { image: true, createdAt: true },
    });
    const terminal = assets.get(path.terminal.assetId);
    if (!profile || !terminal) throw new Error('Storage survivor profile ownership changed');
    const expectedScopes = [
      { subjectId: instance.subjectId, generation: instance.generation },
      { subjectId, generation: profile.createdAt.getTime() },
    ];
    const claims = copies.flatMap((copy) =>
      copy.claims.filter((claim) => claim.consumer === path.consumer)
    );
    if (
      !claims.length ||
      claims.some(
        (claim) =>
          !isDeepStrictEqual(claim.requiredScopes, expectedScopes) ||
          claim.requiredAssociations !== null
      )
    )
      throw new Error('Storage survivor avatar association changed');
    if (path.terminal.kind === 'live') {
      if (profile.image !== terminal.prepared.reference)
        throw new Error('Storage survivor avatar reference changed');
      consumers.set(path.consumer, profile.image);
    } else if (profile.image !== null && !isBundledAvatarImage(profile.image))
      throw new Error('Storage retired avatar reference changed');
  }
  const registry = new StorageReferenceRegistry(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  for (const asset of graph.assets) {
    const saved = await registry.readReference(asset.prepared.reference);
    if (!saved || !isDeepStrictEqual(saved.asset, asset))
      throw new Error('Storage survivor asset attribution changed');
  }
  await requireAccountedRelocationReferences(database, graph, consumers);
}
