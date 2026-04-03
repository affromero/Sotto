import React from 'react';
import { CitationMarker } from '@/components/ui/CitationMarker';
import type { ReferenceData } from '@/types/reference';

/**
 * Matches a run of one or more consecutive citation markers separated only by
 * whitespace, e.g. "[1] [2] [1]" or "[1,2][3]". Captured as a single match
 * so duplicate reference numbers can be deduplicated before rendering.
 */
const CITATION_GROUP_REGEX = /\[\d+(?:\s*,\s*\d+)*\](?:\s*\[\d+(?:\s*,\s*\d+)*\])*/g;
const SINGLE_CITE_REGEX = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * Parse text containing [N] citation markers and return ReactNode array
 * with CitationMarker components interleaved with plain text.
 * Consecutive markers like [1] [2] [1] are merged and deduplicated.
 */
export function parseTextWithCitations(
  text: string,
  references: ReferenceData[]
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  CITATION_GROUP_REGEX.lastIndex = 0;

  while ((match = CITATION_GROUP_REGEX.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    // Extract all numbers from the group and deduplicate
    const seen = new Set<number>();
    const uniqueNumbers: number[] = [];
    SINGLE_CITE_REGEX.lastIndex = 0;
    let inner: RegExpExecArray | null;
    while ((inner = SINGLE_CITE_REGEX.exec(match[0])) !== null) {
      for (const s of inner[1].split(',')) {
        const n = parseInt(s.trim(), 10);
        if (!seen.has(n)) {
          seen.add(n);
          uniqueNumbers.push(n);
        }
      }
    }

    const matchedRefs = uniqueNumbers
      .map((n) => references.find((r) => r.number === n))
      .filter((r): r is ReferenceData => r !== undefined);

    if (matchedRefs.length > 0) {
      nodes.push(
        <CitationMarker
          key={`cite-${match.index}`}
          references={matchedRefs}
        />
      );
    } else {
      // No matching reference found — render as plain text
      nodes.push(match[0]);
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}
