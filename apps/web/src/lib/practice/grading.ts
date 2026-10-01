/**
 * Grading a submitted practice session: multiple-choice scoring and the
 * per-kind submit paths that turn a finished session into SRS updates.
 *
 * Split out of practice-service.ts, which owns building and starting sessions
 * and had reached its length ceiling. The dependency runs one way: the service
 * imports from here.
 */
import type { PracticeMcItem, PracticeAnswer } from './types';

interface MultipleChoiceScore {
  correct: number;
  total: number;
  score: number;
  correctLemmas: string[];
  incorrectLemmas: string[];
  sections: Record<string, { correct: number; total: number }>;
}

function mcSection(itemId: string): string {
  const prefix = itemId.charAt(0);
  return prefix === 'v' || prefix === 'g' || prefix === 'r' || prefix === 'l' ? prefix : 'q';
}

export function scoreMultipleChoice(
  items: PracticeMcItem[],
  answers: PracticeAnswer[]
): MultipleChoiceScore {
  const sections: Record<string, { correct: number; total: number }> = {};
  const answered = new Map(answers.map((answer) => [answer.itemId, answer.selectedIndex]));
  let correct = 0;
  const correctLemmas: string[] = [];
  const incorrectLemmas: string[] = [];

  for (const item of items) {
    const selectedIndex = answered.get(item.id);
    const section = mcSection(item.id);
    sections[section] ??= { correct: 0, total: 0 };
    sections[section].total += 1;
    const ok = selectedIndex === item.correctIndex;
    if (ok) {
      correct += 1;
      sections[section].correct += 1;
    }
    if (item.vocabLemma) (ok ? correctLemmas : incorrectLemmas).push(item.vocabLemma);
  }

  const total = items.length;
  return {
    correct,
    total,
    score: total > 0 ? correct / total : 0,
    correctLemmas,
    incorrectLemmas,
    sections,
  };
}
