/**
 * Format user feedback (general notes, per-turn comments, sentence-level highlights)
 * into a single readable prompt string for script revision.
 */

interface TurnInfo {
  speaker: string;
  text: string;
}

interface Highlight {
  turnIndex: number;
  text: string;
  note: string;
}

export function formatUserFeedback(params: {
  feedback?: string;
  turnComments?: Record<number, string>;
  highlights?: Highlight[];
  turns?: TurnInfo[];
}): string {
  const sections: string[] = [];

  if (params.feedback?.trim()) {
    sections.push(`### General Feedback\n${params.feedback.trim()}`);
  }

  if (params.turnComments && params.turns) {
    const entries = Object.entries(params.turnComments)
      .map(([idx, comment]) => {
        const i = Number(idx);
        const turn = params.turns![i];
        if (!turn || !comment.trim()) return null;
        return `- Turn ${i} (${turn.speaker}): "${comment.trim()}"`;
      })
      .filter(Boolean);

    if (entries.length > 0) {
      sections.push(`### Turn-Specific Comments\n${entries.join('\n')}`);
    }
  }

  if (params.highlights && params.highlights.length > 0) {
    const entries = params.highlights
      .filter((h) => h.text.trim() && h.note.trim())
      .map((h) => `- Turn ${h.turnIndex}, "${h.text}": "${h.note}"`);

    if (entries.length > 0) {
      sections.push(`### Text Annotations\n${entries.join('\n')}`);
    }
  }

  return sections.join('\n\n');
}
