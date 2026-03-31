import React from 'react';
import { VocabularyMarker } from '@/components/ui/VocabularyMarker';
import { CitationMarker } from '@/components/ui/CitationMarker';
import type { VocabularyEntryData } from '@/types/vocabulary';
import type { ReferenceData } from '@/types/reference';

const VOCAB_REGEX = /\[V(\d+):([^\]]+)\]/g;

/**
 * Parse text containing [V{N}:word] vocabulary markers and return ReactNode array
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
    const displayText = match[2];
    const entry = vocabularyEntries.find((v) => v.number === number);

    if (entry) {
      nodes.push(
        <VocabularyMarker
          key={`vocab-${match.index}`}
          entry={entry}
        >
          {displayText}
        </VocabularyMarker>
      );
    } else {
      // No matching entry found — render the word text as plain text
      nodes.push(displayText);
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

const COMBINED_REGEX = /\[V(\d+):([^\]]+)\]|\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * Parse text containing BOTH [N] citation markers and [V{N}:word] vocabulary markers
 * in a single pass. Returns ReactNode array with CitationMarker and VocabularyMarker
 * components interleaved with plain text.
 */
export function parseTextWithCitationsAndVocabulary(
  text: string,
  references: ReferenceData[],
  vocabularyEntries: VocabularyEntryData[]
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  COMBINED_REGEX.lastIndex = 0;

  while ((match = COMBINED_REGEX.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[1] !== undefined) {
      // Vocabulary marker: [V{N}:word]
      const number = parseInt(match[1], 10);
      const displayText = match[2];
      const entry = vocabularyEntries.find((v) => v.number === number);

      if (entry) {
        nodes.push(
          <VocabularyMarker
            key={`vocab-${match.index}`}
            entry={entry}
          >
            {displayText}
          </VocabularyMarker>
        );
      } else {
        nodes.push(displayText);
      }
    } else if (match[3] !== undefined) {
      // Citation marker: [N] or [N,M,...]
      const numbers = match[3].split(',').map((s) => parseInt(s.trim(), 10));
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
        nodes.push(match[0]);
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}
