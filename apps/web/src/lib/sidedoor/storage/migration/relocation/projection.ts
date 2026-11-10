import { isDeepStrictEqual } from 'node:util';
import {
  validateStorageSurvivorPaths,
  type StorageSurvivorGraph,
  type writeSurvivorProjection,
} from 'thesidedoor-core/storage';
import type { prepareStorageCopiesForDeletion } from '../storage-migration-copy';

type PreparedCopy = Awaited<ReturnType<typeof prepareStorageCopiesForDeletion>>[number];
type Projection = Parameters<typeof writeSurvivorProjection>[0]['projection'];
type Scope = { subjectId: string; generation: number };
type Claim = PreparedCopy['claims'][number];
const key = (assetId: string, consumer: string) => JSON.stringify([assetId, consumer]);

/** Bind per-asset removal and survivor scopes to already verified copy jobs. */
export function planStorageSurvivorProjection(
  graph: StorageSurvivorGraph,
  copies: readonly PreparedCopy[],
  subjects: readonly Scope[]
): Projection {
  const coverage = validateStorageSurvivorPaths(graph);
  const deletedSubjects = new Map<string, Scope>();
  if (!subjects.length) throw new Error('Storage deletion scopes are missing');
  for (const scope of subjects) {
    if (deletedSubjects.has(scope.subjectId))
      throw new Error('Storage deletion scopes are duplicated');
    deletedSubjects.set(scope.subjectId, scope);
  }
  const copyByOperation = new Map<string, PreparedCopy>();
  for (const copy of copies) {
    if (copyByOperation.has(copy.relocationId))
      throw new Error('Storage copy evidence is duplicated');
    const copySubjects = new Map<string, Scope>();
    for (const scope of copy.deletionSubjects) {
      if (copySubjects.has(scope.subjectId))
        throw new Error('Storage copy deletion scopes are duplicated');
      copySubjects.set(scope.subjectId, scope);
    }
    if (
      copySubjects.size !== deletedSubjects.size ||
      [...deletedSubjects].some(([id, scope]) => !isDeepStrictEqual(copySubjects.get(id), scope)) ||
      !isDeepStrictEqual(deletedSubjects.get(copy.deletionScope.subjectId), copy.deletionScope)
    )
      throw new Error('Storage copy deletion scopes do not match');
    copyByOperation.set(copy.relocationId, copy);
  }
  const assets = new Map(graph.assets.map((asset) => [asset.id, asset]));
  for (const asset of graph.assets)
    for (const scope of asset.prepared.scopes) {
      const subject = deletedSubjects.get(scope.subjectId);
      if (subject && !isDeepStrictEqual(subject, scope))
        throw new Error('Storage deletion scope generation changed');
    }
  const assignments = new Map<string, { deleted: boolean; claim: Claim }>();
  for (const receipt of graph.receipts) {
    const copy = copyByOperation.get(receipt.operationId);
    if (
      !copy ||
      copy.sourceAssetId !== receipt.sourceAssetId ||
      copy.destinationAssetId !== receipt.destinationAssetId ||
      !isDeepStrictEqual(copy.source, assets.get(receipt.sourceAssetId)?.prepared) ||
      !isDeepStrictEqual(copy.destination, assets.get(receipt.destinationAssetId)?.prepared) ||
      !isDeepStrictEqual(copy.content, receipt.content) ||
      !isDeepStrictEqual(
        copy.claims.map((claim) => claim.consumer).sort(),
        [...receipt.consumers].sort()
      )
    )
      throw new Error('Storage relocation has no verified original copy');
    for (const claim of copy.claims) {
      const deleted = copy.deletedConsumers.has(claim.consumer);
      if (deleted === copy.survivingConsumers.has(claim.consumer))
        throw new Error('Storage copy consumer classification is ambiguous');
      const avatarOwner =
        claim.consumer.startsWith('profile:') && claim.consumer.endsWith(':avatar')
          ? claim.consumer.slice(0, -':avatar'.length)
          : null;
      if (deleted && (!avatarOwner || !deletedSubjects.has(avatarOwner)))
        throw new Error('Storage copy deletion ownership is not independently verified');
      for (const scope of claim.requiredScopes) {
        const subject = deletedSubjects.get(scope.subjectId);
        if (subject && !isDeepStrictEqual(subject, scope))
          throw new Error('Storage deletion scope generation changed');
      }
      const source = assets.get(receipt.sourceAssetId);
      const destination = assets.get(receipt.destinationAssetId);
      if (
        deleted &&
        !claim.requiredScopes.some(
          (scope) =>
            scope.subjectId === avatarOwner &&
            isDeepStrictEqual(deletedSubjects.get(scope.subjectId), scope) &&
            source?.prepared.scopes.some((candidate) => isDeepStrictEqual(candidate, scope)) &&
            destination?.prepared.scopes.some((candidate) => isDeepStrictEqual(candidate, scope))
        )
      )
        throw new Error('Storage copy consumer is outside the authorized deletion scopes');
      for (const assetId of [receipt.sourceAssetId, receipt.destinationAssetId]) {
        const id = key(assetId, claim.consumer);
        const previous = assignments.get(id);
        if (
          previous &&
          (previous.deleted !== deleted ||
            !isDeepStrictEqual(previous.claim.requiredScopes, claim.requiredScopes) ||
            !isDeepStrictEqual(previous.claim.requiredAssociations, claim.requiredAssociations))
        )
          throw new Error('Storage copy consumer association changed across history');
        assignments.set(id, { deleted, claim });
      }
    }
  }
  const removals = new Map<string, Projection['removals'][number]>();
  const requirements = new Map<string, Projection['requirements'][number]>();
  for (const { path, assetIds } of coverage) {
    let classification: boolean | undefined;
    for (const assetId of assetIds) {
      const assignment = assignments.get(key(assetId, path.consumer));
      if (!assignment || (classification !== undefined && classification !== assignment.deleted))
        throw new Error('Storage relocation path has unverified ownership');
      classification = assignment.deleted;
      if (assignment.deleted) {
        const entry = removals.get(assetId) ?? { assetId, consumers: [], scopes: [] };
        if (!entry.consumers.includes(path.consumer)) entry.consumers.push(path.consumer);
        removals.set(assetId, entry);
      } else {
        if (
          assignment.claim.requiredScopes.some((scope) =>
            isDeepStrictEqual(deletedSubjects.get(scope.subjectId), scope)
          )
        )
          throw new Error('Storage survivor depends on a deleted scope');
        requirements.set(key(assetId, path.consumer), {
          assetId,
          consumer: path.consumer,
          scopes: assignment.claim.requiredScopes,
        });
      }
    }
  }
  for (const asset of graph.assets) {
    const scopes = asset.prepared.scopes.filter((scope) =>
      isDeepStrictEqual(deletedSubjects.get(scope.subjectId), scope)
    );
    if (!scopes.length) continue;
    const entry = removals.get(asset.id) ?? { assetId: asset.id, consumers: [], scopes: [] };
    entry.scopes = scopes;
    removals.set(asset.id, entry);
  }
  const retirementRemovals = graph.retirements
    .filter((retirement) =>
      retirement.attribution
        ? removals.get(retirement.attribution.assetId)?.consumers.includes(retirement.consumer)
        : false
    )
    .map(({ operationId, consumer }) => ({ operationId, consumer }));
  return {
    graph,
    removals: [...removals.values()],
    retirementRemovals,
    requirements: [...requirements.values()],
  };
}
