import type { Prisma } from '@/generated/prisma/client';
import type { GenerationFailure } from '../classes/quality/generation-failure';

/**
 * Types shared by the practice modules. They live apart from
 * practice-service.ts so that practice-grading.ts can use them without the two
 * importing each other.
 */

/** A stored multiple-choice item, answer key included. Never sent to a client. */
export class PracticeIncompleteError extends Error {}

export interface PracticeMcItem {
  id: string;
  prompt: string;
  options: string[];
  passageText?: string;
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
  passageText?: string;
}

export interface PracticeAnswer {
  itemId: string;
  selectedIndex: number;
}

export type SubmitPracticeResult = import('@sotto/shared').PracticeReceipt;

export interface PracticeSpeakingItem {
  id: string;
  targetPhrase: string;
  translation: string;
  referenceTtsUrl: string | null;
  latestRecording?: import('@sotto/shared').SpeakingEvidence | null;
}

export interface PracticeWritingItem {
  id: string;
  task: string;
  guidance: string | null;
  ideas: string[];
  response?: import('@sotto/shared').WritingFeedback | null;
  savedDraft?: string;
}

export interface PracticeBuildLifecycle {
  onGenerationFailure?: (failure: GenerationFailure) => void;
  populate: (data: Prisma.PracticeSessionUncheckedCreateInput) => Promise<{ id: string }>;
}
