import React from 'react';
import { CitationMarker } from '@/components/ui/CitationMarker';
import type { ReferenceData } from '@/types/reference';

const CITATION_REGEX = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * Parse text containing [N] citation markers and return ReactNode array
 * with CitationMarker components interleaved with plain text.
 */
export function parseTextWithCitations(
  text: string,
  references: ReferenceData[]
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state
  CITATION_REGEX.lastIndex = 0;

  while ((match = CITATION_REGEX.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    // Parse citation numbers (handles [1] and [1,2] and [1, 2, 3])
    const numbers = match[1].split(',').map((s) => parseInt(s.trim(), 10));
    const matchedRefs = numbers
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
