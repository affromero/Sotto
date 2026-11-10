import { isDeepStrictEqual } from 'node:util';
import {
  normalizeStorageReference,
  StorageBackendRegistry,
  StorageReferenceRegistry,
  StorageReferenceError,
  validateStorageSurvivorPaths,
  type StorageSurvivorGraph,
  type StorageCleanupDescriptor,
} from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { isBundledAvatarImage } from '@/lib/avatars';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { consumerForStorageField } from '@/lib/sidedoor/storage/core/storage-consumers';
import { visitStorageDeletionReferences } from '@/lib/storage/sidedoor/deletion-targets';
import { captureRelocationComponent } from './inventory';
import { buildStorageSurvivorGraph } from './paths';

/** Compare public and direct object-store addresses to one physical target key. */
export function matchesObjectTarget(
  descriptor: Extract<StorageCleanupDescriptor, { kind: 'object' }>,
  reference: string,
  keys: ReadonlySet<string>
) {
  const endpoint = new URL(descriptor.location.endpoint);
  const pathAlias = new URL(endpoint);
  pathAlias.pathname = `${pathAlias.pathname.replace(/\/+$/, '')}/${descriptor.location.bucket}`;
  const hostAlias = new URL(endpoint);
  const virtualHost = `${descriptor.location.bucket}.${hostAlias.hostname}`.toLowerCase();
  hostAlias.hostname = virtualHost;
  const aliases = [
    ...(descriptor.publicUrl
      ? [{ value: descriptor.publicUrl, encodings: ['raw', 'percent'] as const }]
      : []),
    { value: pathAlias.href, encodings: ['raw', 'percent'] as const },
    ...(hostAlias.hostname === virtualHost
      ? [{ value: hostAlias.href, encodings: ['raw', 'percent'] as const }]
      : []),
  ];
  for (const alias of aliases) {
    let candidate = reference;
    let matchingUrl = false;
    let normalized = false;
    const base = new URL(alias.value);
    try {
      const url = new URL(reference);
      if (url.hostname.replace(/\.+$/, '') !== base.hostname.replace(/\.+$/, '')) continue;
      url.protocol = base.protocol;
      url.host = base.host;
      url.search = '';
      url.hash = '';
      candidate = url.href;
      matchingUrl = true;
    } catch {
      // Raw storage keys remain valid input to the canonical normalizer.
    }
    for (const publicUrlEncoding of alias.encodings) {
      try {
        const key = normalizeStorageReference(descriptor.location, candidate, {
          publicUrl: alias.value,
          publicUrlEncoding,
        });
        normalized = true;
        if (keys.has(key)) return true;
      } catch (error) {
        if (!(error instanceof StorageReferenceError)) throw error;
      }
    }
    if (matchingUrl && (!normalized || /%(?:25|2f|5c)|\/{2,}/i.test(new URL(candidate).pathname))) {
      let path = new URL(candidate).pathname;
      try {
        for (let depth = 0; depth < 3; depth++) {
          const prefix = base.pathname.replace(/\/+$/, '');
          const merged = path.replace(/\/{2,}/g, '/');
          if (!prefix || merged === prefix || merged.startsWith(`${prefix}/`)) return true;
          const decoded = decodeURIComponent(path);
          if (decoded === path) break;
          path = decoded;
        }
      } catch {
        return true;
      }
    }
  }
  return false;
}

/** Check current application references against the exact verified inventory. */
export async function requireAccountedRelocationReferences(
  database: Prisma.TransactionClient,
  graph: StorageSurvivorGraph,
  consumers: ReadonlyMap<string, string>
) {
  const historicalReferences = new Set(graph.assets.map((asset) => asset.prepared.reference));
  const registry = new StorageReferenceRegistry(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  const targets = new Map<string, Set<string>>();
  const prefixes = new Map<string, Set<string>>();
  for (const asset of graph.assets) {
    const saved = await registry.readAsset(asset.id);
    if (!saved || !isDeepStrictEqual(saved.asset, asset))
      throw new Error('Storage projection asset attribution changed');
    const binding = asset.prepared.target.binding;
    const keys = targets.get(binding) ?? new Set<string>();
    keys.add(asset.prepared.target.key);
    targets.set(binding, keys);
  }
  const backends = new StorageBackendRegistry(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  const descriptors: Array<{
    descriptor: NonNullable<Awaited<ReturnType<typeof backends.get>>>['descriptor'];
    keys: Set<string>;
  }> = [];
  let inventoryCount = 0;
  let cursor: string | null = null;
  do {
    const page = await registry.listAssets(cursor);
    inventoryCount += page.assets.length;
    if (inventoryCount > 100_000) throw new Error('Storage reference inventory is too large');
    for (const asset of page.assets) {
      const binding = asset.prepared.target.binding;
      const prefix = asset.prepared.localRoutePrefix;
      if (!targets.has(binding) || !prefix) continue;
      const values = prefixes.get(binding) ?? new Set<string>();
      values.add(prefix);
      prefixes.set(binding, values);
    }
    if (cursor && page.cursor && page.cursor <= cursor)
      throw new Error('Storage reference inventory cursor did not advance');
    cursor = page.cursor;
  } while (cursor !== null);
  do {
    const page = await backends.list(cursor);
    inventoryCount += page.backends.length;
    if (inventoryCount > 100_000) throw new Error('Storage reference inventory is too large');
    for (const backend of page.backends) {
      const keys = targets.get(backend.binding);
      if (keys) descriptors.push({ descriptor: backend.descriptor, keys });
    }
    if (cursor && page.cursor && page.cursor <= cursor)
      throw new Error('Storage backend inventory cursor did not advance');
    cursor = page.cursor;
  } while (cursor !== null);
  let comparisons = 0;
  function belongsToHistory(reference: string) {
    if (historicalReferences.has(reference)) return true;
    const candidates = new Set([reference]);
    try {
      const url = new URL(reference);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        url.hostname = url.hostname.replace(/\.+$/, '');
        url.search = '';
        url.hash = '';
        candidates.add(url.href);
        let path = url.pathname;
        for (let depth = 0; depth < 3; depth++) {
          candidates.add(path);
          candidates.add(path.replace(/\/{2,}/g, '/'));
          const decoded = decodeURIComponent(path);
          if (decoded === path) break;
          path = decoded;
        }
        candidates.add(path);
        candidates.add(path.replace(/\/{2,}/g, '/'));
      }
    } catch {
      // Non-URL references are checked in their original form.
    }
    for (const target of descriptors) {
      const { descriptor } = target;
      const localPrefixes =
        descriptor.kind === 'local'
          ? [...(prefixes.get(descriptor.identity.binding) ?? []), undefined]
          : [undefined];
      for (const localRoutePrefix of localPrefixes)
        for (const candidate of candidates) {
          if (++comparisons > 1_000_000)
            throw new Error('Storage reference comparison exceeds its limit');
          try {
            if (descriptor.kind === 'object') {
              if (matchesObjectTarget(descriptor, candidate, target.keys)) return true;
              continue;
            }
            const key = normalizeStorageReference(
              { kind: 'local', root: descriptor.referenceRoot },
              candidate,
              { localRoutePrefix }
            );
            if (target.keys.has(key)) return true;
          } catch (error) {
            if (!(error instanceof StorageReferenceError)) throw error;
          }
        }
    }
    return false;
  }
  let after: string | null = null;
  do {
    const users: { id: string; image: string | null }[] = await database.user.findMany({
      where: {
        image: { not: null },
        ...(after ? { id: { gt: after } } : {}),
      },
      select: { id: true, image: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    for (const user of users)
      if (
        user.image &&
        belongsToHistory(user.image) &&
        consumers.get(`profile:${user.id}:avatar`) !== user.image
      )
        throw new Error('Storage projection has an unaccounted application reference');
    after = users.length === 100 ? users[users.length - 1]!.id : null;
  } while (after !== null);
  await visitStorageDeletionReferences(database, { kind: 'instance' }, async (page) => {
    for (const row of page.rows)
      for (const [field, reference] of Object.entries(row.references)) {
        if (!belongsToHistory(reference)) continue;
        const consumer = consumerForStorageField(page.source, row.id, field);
        if (!consumer || consumers.get(consumer) !== reference)
          throw new Error('Storage projection has an unaccounted application reference');
      }
  });
}

/**
 * Inspect current avatar ownership in retained projected history. This does not
 * establish original copy provenance or authorize erasure.
 */
export async function inspectRetainedAvatarProjection(
  database: Prisma.TransactionClient,
  graph: StorageSurvivorGraph,
  input: {
    subjects: readonly { subjectId: string; generation: number }[];
    consumers: ReadonlyMap<string, string>;
  }
) {
  const seed = graph.paths[0]?.originalAssetId;
  if (!seed) throw new Error('Storage projection has no survivor path');
  const captured = buildStorageSurvivorGraph(
    await captureRelocationComponent(database, { seedAssetIds: [seed] })
  );
  if (!isDeepStrictEqual(captured, graph)) throw new Error('Storage projection history changed');
  const coverage = validateStorageSurvivorPaths(graph);
  if (!graph.receipts.length || graph.receipts.some((receipt) => receipt.schemaVersion !== 2))
    throw new Error('Storage projection history is not fully retained');
  const subjects = new Map(input.subjects.map((scope) => [scope.subjectId, scope]));
  if (!subjects.size || subjects.size !== input.subjects.length)
    throw new Error('Storage deletion scopes are missing or duplicated');
  const instance = await sottoStorageInstance(database).read();
  const instanceScope = { subjectId: instance.subjectId, generation: instance.generation };
  const references = new StorageReferenceRegistry(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  const assets = new Map(graph.assets.map((asset) => [asset.id, asset]));
  await requireAccountedRelocationReferences(database, graph, input.consumers);
  for (const asset of graph.assets) {
    for (const scope of asset.prepared.scopes) {
      if (
        !isDeepStrictEqual(scope, instanceScope) &&
        !isDeepStrictEqual(subjects.get(scope.subjectId), scope)
      )
        throw new Error('Storage projection has an owner outside the deletion');
    }
    const retained = await references.readReference(asset.prepared.reference);
    if (!retained || !isDeepStrictEqual(retained.asset, asset))
      throw new Error('Storage projection asset attribution changed');
  }
  for (const { path, assetIds } of coverage) {
    if (
      assetIds.length < 2 ||
      !path.consumer.startsWith('profile:') ||
      !path.consumer.endsWith(':avatar')
    )
      throw new Error('Storage projection deletion ownership is not independently verified');
    const subjectId = path.consumer.slice(0, -':avatar'.length);
    const scope = subjects.get(subjectId);
    const id = subjectId.slice('profile:'.length);
    const profile = await database.user.findUnique({
      where: { id },
      select: { image: true, createdAt: true },
    });
    if (!scope || !profile || profile.createdAt.getTime() !== scope.generation)
      throw new Error('Storage projection profile ownership changed');
    const terminal = assets.get(path.terminal.assetId);
    if (
      !terminal ||
      !terminal.prepared.scopes.some((candidate) => isDeepStrictEqual(candidate, scope))
    )
      throw new Error('Storage projection profile scope is missing');
    if (path.terminal.kind === 'live') {
      if (
        profile.image !== terminal.prepared.reference ||
        input.consumers.get(path.consumer) !== profile.image
      )
        throw new Error('Storage projection consumer ownership changed');
    } else if (
      input.consumers.has(path.consumer) ||
      (profile.image !== null && !isBundledAvatarImage(profile.image))
    )
      throw new Error('Storage projection retired consumer ownership changed');
  }
  return graph.receipts.map((receipt) => receipt.operationId);
}
