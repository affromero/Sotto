import type { QualityInput } from '../types.js';

/**
 * Compute quality signal (0-1).
 * Weighted composite: completion×0.4 + likes×0.3 + refs×0.2 + interactions×0.1
 */
export function computeQuality(input: QualityInput): number {
  const { avgCompletionRate, likeToListenRatio, verifiedReferenceRate, interactionRate } = input;

  const score =
    (avgCompletionRate / 100) * 0.4 +
    likeToListenRatio * 0.3 +
    verifiedReferenceRate * 0.2 +
    interactionRate * 0.1;

  return Math.max(0, Math.min(score, 1));
}
