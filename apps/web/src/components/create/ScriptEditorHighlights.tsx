import type { ReactNode } from 'react';
import { parseTextWithCitations } from '@/lib/citation-parser';
import type { ReferenceData } from '@/types/reference';

export interface Highlight {
  turnIndex: number;
  text: string;
  note: string;
}

type HighlightStyles = Record<string, string>;

interface RenderHighlightedTurnTextOptions {
  turnIndex: number;
  text: string;
  highlights: Highlight[];
  references: ReferenceData[];
  styles: HighlightStyles;
}

export function renderHighlightedTurnText({
  turnIndex,
  text,
  highlights,
  references,
  styles,
}: RenderHighlightedTurnTextOptions): ReactNode {
  const turnHighlights = highlights.filter((h) => h.turnIndex === turnIndex);
  if (turnHighlights.length === 0) {
    return references.length > 0 ? parseTextWithCitations(text, references) : text;
  }

  type Segment = { text: string; highlight?: Highlight };
  const segments: Segment[] = [];
  let offset = 0;

  const positioned = turnHighlights
    .map((h) => ({ ...h, pos: text.indexOf(h.text, 0) }))
    .filter((h) => h.pos !== -1)
    .sort((a, b) => a.pos - b.pos);

  for (const h of positioned) {
    const pos = text.indexOf(h.text, offset);
    if (pos === -1) continue;
    if (pos > offset) {
      segments.push({ text: text.slice(offset, pos) });
    }
    segments.push({ text: h.text, highlight: h });
    offset = pos + h.text.length;
  }
  if (offset < text.length) {
    segments.push({ text: text.slice(offset) });
  }

  return segments.map((seg, i) => {
    const content = references.length > 0 ? parseTextWithCitations(seg.text, references) : seg.text;

    if (seg.highlight) {
      return (
        <mark key={i} className={styles.highlightedText} title={seg.highlight.note}>
          {content}
          <span className={styles.annotationBadge} aria-label="Has annotation">
            {turnHighlights.indexOf(seg.highlight) + 1}
          </span>
        </mark>
      );
    }
    return <span key={i}>{content}</span>;
  });
}
