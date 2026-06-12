/**
 * Reference count and quality thresholds for episode scripts.
 * Extracted from script-verifier.ts so they can be used by both
 * the compile/QC step and the legacy verification pipeline.
 */

const BASE_REFERENCE_COUNTS: Record<string, number> = {
  deep_dive: 10,
  standard: 5,
  quick_overview: 3,
  eli5: 2,
};

const REFS_PER_MINUTE: Record<string, number> = {
  deep_dive: 1.5,
  standard: 1.0,
  quick_overview: 0.7,
  eli5: 0.5,
};

export function getMinReferenceCount(depth: string, durationMinutes?: number): number {
  const base = BASE_REFERENCE_COUNTS[depth] ?? 5;
  if (!durationMinutes || durationMinutes <= 0) return base;
  const scaled = Math.round((REFS_PER_MINUTE[depth] ?? 1.0) * durationMinutes);
  return Math.max(base, scaled);
}

/** @deprecated Use getMinReferenceCount() instead */
export const MIN_REFERENCE_COUNTS = BASE_REFERENCE_COUNTS;

export const SERIOUS_REFERENCE_TYPES: Set<string> = new Set(['PAPER', 'BOOK', 'REPORT']);

const BASE_SERIOUS_RATIO: Record<string, number> = {
  deep_dive: 0.6,
  standard: 0.4,
  quick_overview: 0.2,
  eli5: 0,
};

const LOW_SERIOUS_TONES = new Set(['comedic', 'satirical', 'storytelling']);

export function getMinSeriousRatio(depth: string, tone?: string): number {
  const base = BASE_SERIOUS_RATIO[depth] ?? 0.4;
  if (tone && LOW_SERIOUS_TONES.has(tone)) return Math.max(0, base * 0.5);
  return base;
}

/** @deprecated Use getMinSeriousRatio() instead */
export const MIN_SERIOUS_RATIO = BASE_SERIOUS_RATIO;

export const REFERENCE_TYPE_WEIGHTS: Record<string, number> = {
  PAPER: 1.0,
  BOOK: 0.9,
  REPORT: 0.85,
  ARTICLE: 0.6,
  VIDEO: 0.5,
  WEB: 0.4,
};
