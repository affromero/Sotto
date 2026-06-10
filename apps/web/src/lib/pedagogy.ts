// Learner-selectable teaching approaches, grounded in second-language-acquisition
// research. People learn differently, so if one approach is not working a learner
// can switch. Each style threads a methodology instruction into generation (via the
// existing learner-context slot), so classes, practice, listening, speaking, and
// writing all shape themselves to the chosen approach. The guidance is evidence
// based, not invented, and never tells the model to fabricate content.
import type { PedagogyStyle } from '@sotto/shared';

export interface PedagogyStyleInfo {
  id: PedagogyStyle;
  label: string;
  /** One-line description for the picker. */
  summary: string;
  /** The research it draws on, shown in the UI for transparency. */
  basis: string;
  /** Methodology instruction injected into generation. */
  guidance: string;
}

export const PEDAGOGY_STYLES: PedagogyStyleInfo[] = [
  {
    id: 'BALANCED',
    label: 'Balanced',
    summary: 'A well-rounded mix. The default if you are not sure.',
    basis: 'Combines comprehensible input, focus on form, and retrieval practice.',
    guidance:
      'Teach with a balanced method: mix comprehensible input, brief explicit explanation of form when it helps, and active recall. Keep coverage well-rounded across meaning and accuracy.',
  },
  {
    id: 'IMMERSION',
    label: 'Immersion',
    summary: 'Mostly target language, learn from context, meaning first.',
    basis: 'Krashen’s input hypothesis (comprehensible input, i+1).',
    guidance:
      'Teach by immersion: lead in the target language and keep it slightly above the learner’s current level (i+1). Minimize native-language translation, infer meaning from context, and prioritize understanding over explicit grammar rules.',
  },
  {
    id: 'GRAMMAR',
    label: 'Grammar-first',
    summary: 'Clear rules and patterns explained up front, then practice.',
    basis: 'Focus on form and explicit, deductive instruction.',
    guidance:
      'Teach grammar-first: state the rule or pattern plainly, show a clear paradigm, then build from rule to example. Use the learner’s native language to explain when it speeds understanding, and call out common errors.',
  },
  {
    id: 'COMMUNICATION',
    label: 'Conversation-first',
    summary: 'Realistic tasks and speaking, fluency over perfection.',
    basis: 'Swain’s output hypothesis and communicative language teaching.',
    guidance:
      'Teach communication-first: frame everything as realistic interaction and tasks the learner produces (messages, role-plays, situations). Prioritize getting the message across and fluency over perfect accuracy, and prompt the learner to produce language often.',
  },
  {
    id: 'INTENSIVE',
    label: 'Intensive review',
    summary: 'Heavy recall and spaced repetition of weak items.',
    basis: 'The testing effect (retrieval practice) and spaced repetition.',
    guidance:
      'Teach with intensive retrieval practice: maximize active recall, recycle the learner’s due and weak items heavily, and keep difficulty at the edge of their ability so each item is effortful but achievable.',
  },
];

const STYLE_BY_ID = new Map(PEDAGOGY_STYLES.map((s) => [s.id, s]));

export function getPedagogyStyle(style: PedagogyStyle): PedagogyStyleInfo {
  return STYLE_BY_ID.get(style) ?? PEDAGOGY_STYLES[0];
}

export function isPedagogyStyle(value: unknown): value is PedagogyStyle {
  return typeof value === 'string' && STYLE_BY_ID.has(value as PedagogyStyle);
}

/** The methodology instruction for a style, as a labelled block (empty for none). */
export function formatPedagogyForPrompt(style: PedagogyStyle): string {
  const info = getPedagogyStyle(style);
  return `\nTeaching approach (${info.label}): ${info.guidance}\n`;
}

/**
 * Compose the learner-context string that generators thread through the {{NOTES}}
 * slot: the pedagogy methodology first, then the learner's own note. BALANCED with
 * no note collapses to empty so generation is unchanged from before this feature.
 */
export function buildLearnerContext(note: string, style: PedagogyStyle): string {
  const trimmedNote = note.trim();
  // BALANCED (and any unset/invalid value) adds no methodology, so generation is
  // unchanged from before this feature.
  const resolved = isPedagogyStyle(style) ? style : 'BALANCED';
  const pedagogy = resolved === 'BALANCED' ? '' : formatPedagogyForPrompt(resolved).trim();
  return [pedagogy, trimmedNote].filter(Boolean).join('\n\n');
}
