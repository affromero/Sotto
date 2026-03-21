/** A record of user interaction with a creator's content. */
export interface FatigueEntry {
  creatorId: string;
  action: 'skip' | 'dismiss' | 'not_interested';
  timestamp: Date | string;
}

export interface FatigueConfig {
  enabled: boolean;
  decayDays: number;
  maxPenalty: number;
  penaltyPerAction: number;
}

export const DEFAULT_FATIGUE_CONFIG: FatigueConfig = {
  enabled: true,
  decayDays: 14,
  maxPenalty: 0.8,
  penaltyPerAction: 0.15,
};

/**
 * Compute a fatigue multiplier (0-1) for a specific creator.
 * Recent negative signals (skip, dismiss, not_interested) reduce the multiplier.
 * Signals decay linearly over `decayDays`.
 *
 * Returns 1.0 (no penalty) when no fatigue signals exist.
 */
export function computeFatigueMultiplier(
  entries: FatigueEntry[],
  creatorId: string,
  config: FatigueConfig = DEFAULT_FATIGUE_CONFIG,
  now: Date = new Date()
): number {
  if (!config.enabled) return 1;

  const creatorEntries = entries.filter((e) => e.creatorId === creatorId);
  if (creatorEntries.length === 0) return 1;

  let totalPenalty = 0;
  const decayMs = config.decayDays * 24 * 60 * 60 * 1000;

  for (const entry of creatorEntries) {
    const entryTime = typeof entry.timestamp === 'string' ? new Date(entry.timestamp) : entry.timestamp;
    const age = now.getTime() - entryTime.getTime();

    if (age > decayMs) continue;

    // Linear decay: full penalty at age=0, zero at age=decayMs
    const decayFactor = 1 - age / decayMs;
    totalPenalty += config.penaltyPerAction * decayFactor;
  }

  const clampedPenalty = Math.min(totalPenalty, config.maxPenalty);
  return Math.max(0, 1 - clampedPenalty);
}
