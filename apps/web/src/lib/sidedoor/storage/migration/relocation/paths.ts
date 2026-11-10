import { validateStorageSurvivorPaths, type StorageSurvivorGraph } from 'thesidedoor-core/storage';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import type { captureRelocationComponent } from './inventory';

const MAX_HOPS = 1000;
const key = (assetId: string, consumer: string) => JSON.stringify([assetId, consumer]);

/** Build paths only when every related record is explained by the captured component. */
export function buildStorageSurvivorGraph(
  component: Awaited<ReturnType<typeof captureRelocationComponent>>
): StorageSurvivorGraph {
  if (
    component.outsideAssets.length ||
    component.outsideAllocations.length ||
    component.outsideReceipts.length ||
    component.missingOutsideAssetIds.length ||
    component.unresolvedPreviousReferences.length ||
    component.missingRetirementClaims.length
  )
    throw new Error('Storage relocation has unclassified related history');
  const assets = new Map(component.assets.map((asset) => [asset.id, asset]));
  const incoming = new Set<string>();
  const successors = new Map<string, (typeof component.receipts)[number]>();
  for (const receipt of component.receipts) {
    for (const consumer of receipt.consumers) {
      const previous = key(receipt.sourceAssetId, consumer);
      const next = key(receipt.destinationAssetId, consumer);
      if (successors.has(previous) || incoming.has(next))
        throw new Error('Storage relocation history is ambiguous');
      successors.set(previous, receipt);
      incoming.add(next);
    }
  }
  const terminalRetirements = new Map<string, (typeof component.retirements)[number][]>();
  for (const retirement of component.retirements) {
    if (!retirement.attribution || retirement.status !== 'pending' || retirement.replacementAssetId)
      continue;
    const id = key(retirement.attribution.assetId, retirement.consumer);
    const values = terminalRetirements.get(id) ?? [];
    values.push(retirement);
    terminalRetirements.set(id, values);
  }
  const paths: StorageSurvivorGraph['paths'] = [];
  for (const allocation of component.allocations) {
    for (const claim of allocation.claims) {
      if (incoming.has(key(allocation.assetId, claim.consumer))) continue;
      if (claim.previousReference !== null)
        throw new Error('Storage relocation origin requires independent verification');
      let assetId = allocation.assetId;
      const seen = new Set<string>();
      for (;;) {
        if (seen.has(assetId)) throw new Error('Storage relocation history contains a cycle');
        seen.add(assetId);
        const next = successors.get(key(assetId, claim.consumer));
        if (!next) break;
        if (seen.size > MAX_HOPS) throw new Error('Storage relocation history exceeds its limit');
        assetId = next.destinationAssetId;
      }
      const terminal = assets.get(assetId);
      if (!terminal) throw new Error('Storage relocation terminal asset is missing');
      if (terminal.consumers.includes(claim.consumer)) {
        paths.push({
          consumer: claim.consumer,
          originalAssetId: allocation.assetId,
          terminal: { kind: 'live', assetId },
          maxHops: MAX_HOPS,
        });
        continue;
      }
      const retirements = terminalRetirements.get(key(assetId, claim.consumer)) ?? [];
      if (retirements.length !== 1)
        throw new Error('Storage relocation terminal retirement is ambiguous');
      paths.push({
        consumer: claim.consumer,
        originalAssetId: allocation.assetId,
        terminal: { kind: 'retired', assetId, operationId: retirements[0]!.operationId },
        maxHops: MAX_HOPS,
      });
    }
  }
  const graph: StorageSurvivorGraph = {
    namespace: SIDEDOOR_STATE_ID,
    assets: component.assets,
    allocations: component.allocations,
    retirements: component.retirements,
    receipts: component.receipts,
    successors: component.receipts.flatMap((receipt) =>
      receipt.consumers.map((consumer) => ({
        sourceAssetId: receipt.sourceAssetId,
        consumer,
        operationId: receipt.operationId,
      }))
    ),
    paths,
  };
  validateStorageSurvivorPaths(graph);
  return graph;
}
