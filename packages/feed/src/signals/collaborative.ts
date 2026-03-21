import type { CollaborativeInput } from '../types.js';

/**
 * Compute collaborative filtering signal (0-1).
 * Mean of completion rates from similar users, clamped to [0, 1].
 */
export function computeCollaborative(input: CollaborativeInput): number {
  const { completionRates } = input;

  if (completionRates.length === 0) {
    return 0;
  }

  const mean =
    completionRates.reduce((sum, rate) => sum + rate / 100, 0) / completionRates.length;

  return Math.max(0, Math.min(mean, 1));
}
