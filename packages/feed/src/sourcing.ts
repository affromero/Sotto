export interface SourcingConfig {
  inNetworkRatio: number;
}

export const DEFAULT_SOURCING_CONFIG: SourcingConfig = {
  inNetworkRatio: 0.6,
};

export interface SourcingResult<T> {
  inNetwork: T[];
  outOfNetwork: T[];
}

/**
 * Split candidates into in-network and out-of-network pools.
 * Target ratio is `inNetworkRatio` (default 60/40).
 * If one pool is exhausted, the other fills remaining slots.
 */
export function sourceCandidates<T>(
  candidates: T[],
  isInNetwork: (candidate: T) => boolean,
  totalBudget: number,
  config: SourcingConfig = DEFAULT_SOURCING_CONFIG
): SourcingResult<T> {
  const inPool: T[] = [];
  const outPool: T[] = [];

  for (const c of candidates) {
    if (isInNetwork(c)) {
      inPool.push(c);
    } else {
      outPool.push(c);
    }
  }

  const inBudget = Math.round(totalBudget * config.inNetworkRatio);
  const outBudget = totalBudget - inBudget;

  // Take up to budget, overflow to the other pool
  const inTake = inPool.slice(0, inBudget);
  const outTake = outPool.slice(0, outBudget);

  // If one pool is short, fill from the other
  const inRemaining = inBudget - inTake.length;
  const outRemaining = outBudget - outTake.length;

  if (inRemaining > 0) {
    outTake.push(...outPool.slice(outBudget, outBudget + inRemaining));
  }
  if (outRemaining > 0) {
    inTake.push(...inPool.slice(inBudget, inBudget + outRemaining));
  }

  return { inNetwork: inTake, outOfNetwork: outTake };
}
