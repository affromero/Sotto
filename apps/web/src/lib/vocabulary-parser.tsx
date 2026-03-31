import React from 'react';
import { VocabularyMarker } from '@/components/ui/VocabularyMarker';
import type { VocabularyEntryData } from '@/types/vocabulary';

const VOCAB_REGEX = /\[V(\d+)\]/g;

/**
 * Parse text containing [V{N}] vocabulary markers and return ReactNode array
 * with VocabularyMarker components interleaved with plain text.
 */
export function parseTextWithVocabulary(
  text: string,
  vocabularyEntries: VocabularyEntryData[]
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state
  VOCAB_REGEX.lastIndex = 0;

  while ((match = VOCAB_REGEX.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const number = parseInt(match[1], 10);
    const entry = vocabularyEntries.find((v) => v.number === number);

    if (entry) {
      nodes.push(
        <VocabularyMarker
          key={`vocab-${match.index}`}
          entry={entry}
        />
      );
    } else {
      // No matching entry found — render as plain text
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
