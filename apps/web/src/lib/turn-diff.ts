import { createHash } from 'crypto';
import type { ClaimAnalysis } from './script-verifier';

/**
 * Hash a script turn by speaker + text content.
 * Preserves [N] citation markers (sourcing matters for verification).
 * Ignores direction markers like [laughs], [sighs] etc. since they're delivery, not factual.
 */
export function hashTurn(speaker: string, text: string): string {
  const normalized = speaker.toLowerCase() + '\0' + text.trim();
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Match previous claims to new turns by content hash.
 * Unchanged turns get their claims carried forward with remapped indices.
 * Changed/new turns are flagged for re-analysis.
 */
export function matchClaimsToTurns(
  previousClaims: ClaimAnalysis[],
  newTurns: Array<{ speaker: string; text: string }>
): { carried: ClaimAnalysis[]; changedIndices: Set<number> } {
  // Build multimap: hash → claims (greedy consumption for duplicate turns)
  const claimsByHash = new Map<string, ClaimAnalysis[]>();
  for (const claim of previousClaims) {
    if (!claim.turnHash) continue;
    const existing = claimsByHash.get(claim.turnHash) ?? [];
    existing.push(claim);
    claimsByHash.set(claim.turnHash, existing);
  }

  // Track which hash groups have been consumed (for duplicate turns)
  const consumedCounts = new Map<string, number>();
  const carried: ClaimAnalysis[] = [];
  const changedIndices = new Set<number>();

  for (let i = 0; i < newTurns.length; i++) {
    const turn = newTurns[i];
    const hash = hashTurn(turn.speaker, turn.text);
    const matchingClaims = claimsByHash.get(hash);

    if (!matchingClaims || matchingClaims.length === 0) {
      changedIndices.add(i);
      continue;
    }

    // Group claims by their original turnIndex to handle duplicate turns
    const claimsByOriginalIndex = new Map<number, ClaimAnalysis[]>();
    for (const claim of matchingClaims) {
      const existing = claimsByOriginalIndex.get(claim.turnIndex) ?? [];
      existing.push(claim);
      claimsByOriginalIndex.set(claim.turnIndex, existing);
    }

    const consumed = consumedCounts.get(hash) ?? 0;
    const originalIndices = [...claimsByOriginalIndex.keys()].sort((a, b) => a - b);

    if (consumed >= originalIndices.length) {
      // All instances of this duplicate turn already consumed
      changedIndices.add(i);
      continue;
    }

    // Take the next unconsumed group
    const targetIndex = originalIndices[consumed];
    const claimsForThisInstance = claimsByOriginalIndex.get(targetIndex) ?? [];

    for (const claim of claimsForThisInstance) {
      carried.push({
        ...claim,
        turnIndex: i, // remap to new position
      });
    }

    consumedCounts.set(hash, consumed + 1);
  }

  return { carried, changedIndices };
}
