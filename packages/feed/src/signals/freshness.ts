import type { FreshnessInput } from '../types.js';

/**
 * Compute freshness signal (0-1).
 * 30-day linear decay + cold-start bonus (+0.2 if < 10 listeners).
 */
export function computeFreshness(input: FreshnessInput): number {
  const { createdAt, totalUniqueListeners, now = new Date() } = input;

  const createdAtDate = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const ageHours = (now.getTime() - createdAtDate.getTime()) / (1000 * 60 * 60);
  const timeFreshness = Math.max(0, 1 - ageHours / (30 * 24));
  const coldStartBonus = totalUniqueListeners < 10 ? 0.2 : 0;

  return Math.min(timeFreshness + coldStartBonus, 1);
}
