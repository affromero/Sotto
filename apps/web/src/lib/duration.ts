/**
 * Centralized duration constants and helpers for podcast generation.
 *
 * All word-count ↔ duration calculations go through here so the script
 * generator, verifier, and workers stay in sync.
 */

/** Average spoken words per minute (conversational pace). */
export const WORDS_PER_MINUTE = 150;

/** Average characters per second of speech (~750 chars/min ÷ 60). */
export const CHARS_PER_SECOND = 12.5;

/** Acceptable deviation from target duration, in seconds. */
export const DURATION_TOLERANCE_SECONDS = 30;

/** Convert a word count to minutes. */
export function wordsToMinutes(wordCount: number): number {
  return wordCount / WORDS_PER_MINUTE;
}

/** Convert minutes to a target word count (rounded). */
export function minutesToWords(minutes: number): number {
  return Math.round(minutes * WORDS_PER_MINUTE);
}

/**
 * Compute the acceptable word-count range for a given duration target.
 * ±75 words = ±30 seconds at 150 WPM.
 */
export function wordCountBounds(durationMinutes: number): {
  target: number;
  min: number;
  max: number;
} {
  const tolerance = (DURATION_TOLERANCE_SECONDS / 60) * WORDS_PER_MINUTE; // 75
  const target = minutesToWords(durationMinutes);
  return {
    target,
    min: target - tolerance,
    max: target + tolerance,
  };
}

/** Estimate audio duration (in seconds) from raw text length. */
export function estimateDurationFromText(text: string): number {
  return text.length / CHARS_PER_SECOND;
}

/** Count words in text (trim to avoid empty-string inflation from leading/trailing whitespace). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Sum word counts across script turns. */
export function countScriptWords(turns: Array<{ text: string }>): number {
  return turns.reduce((sum, t) => sum + countWords(t.text), 0);
}
