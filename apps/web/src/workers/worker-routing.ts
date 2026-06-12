/**
 * Worker routing — pure functions that determine which workers run
 * based on profile, preset, and filter configuration.
 *
 * The `core` preset uses a DENYLIST (EXPERIMENTAL_WORKERS) rather than
 * an allowlist. New workers run by default; only explicitly experimental
 * workers are excluded. This prevents the class of bug where a new
 * production worker is added but forgotten in a CORE_WORKERS allowlist.
 */

/** GPU/API-heavy workers that need beefy containers */
export const HEAVY_WORKERS = new Set([
  'audio-generation',
  'audio-stitching',
]);

/** Pipeline orchestration workers */
export const PIPELINE_WORKERS = new Set([
  'content-extraction',
  'deep-research',
  'creative-planning',
  'script-writing',
  'compile-script',
  'script-generation',
  'interactions',
  'segment-regeneration',
  'speaking-grading',
  'worksheet-pdf',
  'verify-class-references',
]);

/**
 * Workers excluded from the `core` preset — dev-only or experimental.
 * Everything NOT in this set runs by default under `core`.
 */
export const EXPERIMENTAL_WORKERS = new Set<string>();

/** Check if a worker matches the given profile (heavy/pipeline/light/all) */
export function matchesProfile(name: string, profile: string): boolean {
  if (profile === 'all') return true;
  if (profile === 'heavy') return HEAVY_WORKERS.has(name);
  if (profile === 'pipeline') return PIPELINE_WORKERS.has(name);
  if (profile === 'light') return !HEAVY_WORKERS.has(name) && !PIPELINE_WORKERS.has(name);
  return true;
}

/** Check if a worker matches the given preset (core/full) */
export function matchesPreset(name: string, preset: string): boolean {
  if (preset === 'full') return true;
  if (preset === 'core') return !EXPERIMENTAL_WORKERS.has(name);
  // Unknown preset — caller handles warning
  return true;
}

export interface ShouldRunOptions {
  profile: string;
  preset: string;
  includeFilter: Set<string>;
  excludeFilter: Set<string>;
}

/** Determine whether a worker should run given all routing parameters */
export function shouldRun(name: string, options: ShouldRunOptions): boolean {
  if (!matchesProfile(name, options.profile)) return false;
  if (options.excludeFilter.has(name)) return false;
  if (options.includeFilter.size > 0) return options.includeFilter.has(name);
  return matchesPreset(name, options.preset);
}
