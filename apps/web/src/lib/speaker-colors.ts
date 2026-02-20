/**
 * Maps a speaker label to a consistent CSS variable index (0–3).
 * Components use this to select `--color-speaker-N` / `--color-speaker-N-bg`.
 */
export function getSpeakerIndex(speaker: string, allSpeakers: string[]): number {
  const idx = allSpeakers.indexOf(speaker);
  return idx >= 0 ? idx % 4 : 0;
}

/**
 * Extracts the ordered list of unique speakers from turns/segments.
 * Preserves first-appearance order so Host (first speaker) always gets index 0.
 */
export function getUniqueSpeakers(items: Array<{ speaker: string }>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (!seen.has(item.speaker)) {
      seen.add(item.speaker);
      result.push(item.speaker);
    }
  }
  return result;
}
