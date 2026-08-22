/**
 * Types shared by the practice modules. They live apart from
 * practice-service.ts so that practice-grading.ts can use them without the two
 * importing each other.
 */

/** A stored multiple-choice item, answer key included. Never sent to a client. */
export interface PracticeMcItem {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  vocabLemma: string | null;
  focusTargetId: string | null;
}

/** The client-safe projection of a stored item. */
export interface PracticeMcItemPublic {
  id: string;
  prompt: string;
  options: string[];
}

export interface PracticeAnswer {
  itemId: string;
  selectedIndex: number;
}

export interface SubmitPracticeResult {
  score: number;
  correct: number;
  total: number;
}
