/**
 * Script updater — cleans up citation markers when references are removed
 * and renumbers remaining references to maintain contiguous numbering.
 */

type ScriptTurn = {
  speaker: string;
  text: string;
  direction?: string;
};

/**
 * Build a renumber map: given all reference numbers and the removed ones,
 * produce a mapping from old number to new contiguous number.
 *
 * Example: allNumbers=[1,2,3,4,5], removedNumbers=[2,4]
 * Result: {1→1, 3→2, 5→3}
 */
export function buildRenumberMap(
  allNumbers: number[],
  removedNumbers: Set<number>
): Map<number, number> {
  const kept = allNumbers.filter((n) => !removedNumbers.has(n)).sort((a, b) => a - b);
  const map = new Map<number, number>();
  kept.forEach((oldNum, index) => {
    map.set(oldNum, index + 1);
  });
  return map;
}

/**
 * Clean a single text string: remove dangling citation markers for removed
 * references, renumber remaining ones.
 *
 * Handles:
 * - Single citations: [3]
 * - Grouped citations: [1,3,5] or [1, 3, 5]
 * - Adjacent citations: [1][3]
 * - Orphaned spaces/punctuation after removal
 */
export function cleanCitationText(
  text: string,
  removedNumbers: Set<number>,
  renumberMap: Map<number, number>
): string {
  // Match citation groups: [N] or [N,M,...] with optional spaces
  const citationPattern = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

  let result = text.replace(citationPattern, (_match, inner: string) => {
    const nums = inner.split(',').map((s: string) => parseInt(s.trim(), 10));
    const kept = nums.filter((n: number) => !removedNumbers.has(n));

    if (kept.length === 0) {
      return '';
    }

    const renumbered = kept.map((n: number) => renumberMap.get(n) ?? n);
    return `[${renumbered.join(',')}]`;
  });

  // Collapse adjacent duplicate citation markers (e.g. "[3] [3]" → "[3]")
  result = result.replace(
    /\[(\d+(?:,\d+)*)\]\s*\[(\d+(?:,\d+)*)\]/g,
    (fullMatch, first: string, second: string) => {
      const firstSet = new Set(first.split(',').map(Number));
      const secondNums = second.split(',').map(Number);
      if (secondNums.every((n) => firstSet.has(n))) {
        return `[${first}]`;
      }
      return fullMatch;
    }
  );

  // Clean up orphaned double spaces left by removed citations
  result = result.replace(/  +/g, ' ');

  // Clean up space before punctuation: "something . Next" → "something. Next"
  result = result.replace(/ ([.,;:!?])/g, '$1');

  // Clean up trailing spaces at line ends
  result = result.replace(/ +$/gm, '');

  return result;
}

/**
 * Clean and renumber citations across all script turns.
 * Returns a new array of turns with updated text.
 */
export function cleanAndRenumberCitations(
  turns: ScriptTurn[],
  removedNumbers: Set<number>,
  renumberMap: Map<number, number>
): ScriptTurn[] {
  return turns.map((turn) => ({
    ...turn,
    text: cleanCitationText(turn.text, removedNumbers, renumberMap),
  }));
}

/**
 * Clean and renumber citations in a markdown string.
 */
export function cleanAndRenumberMarkdown(
  markdown: string,
  removedNumbers: Set<number>,
  renumberMap: Map<number, number>
): string {
  return cleanCitationText(markdown, removedNumbers, renumberMap);
}
