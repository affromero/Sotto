import type { ClassTeaching } from '@sotto/shared';

const EXERCISE_REVIEW_KINDS = new Set(['explanations', 'listening', 'speaking', 'writing']);

export function isInitialA1ExerciseReview(
  level: string | undefined,
  initialA1Class: boolean | undefined,
  kind: string | undefined
): boolean {
  return level === 'A1' && initialA1Class === true && EXERCISE_REVIEW_KINDS.has(kind ?? '');
}

/** Show exercise reviewers only the guided material available before its answer is revealed. */
export function prerequisiteReviewTeaching(teaching: ClassTeaching, project: boolean) {
  if (!project) return teaching;
  return {
    ...teaching,
    guidedPractice: {
      prompt: teaching.guidedPractice.prompt,
      hint: teaching.guidedPractice.hint,
    },
  };
}

export const PRE_DISCLOSURE_REVIEW_CONTEXT =
  'The teaching context includes only material available before the guided answer is revealed. Its guided answer and explanation are intentionally omitted. The guided prompt is a task, and its hint is optional. Neither is prior explained teaching. Do not count a concealed answer as prior teaching.';
