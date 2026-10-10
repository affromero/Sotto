import type { GeneratedQuestion } from '../../../class-generation';
import type { SectionReviewFeedback } from '../../section-quality';

export interface VocabularyRepairSelection {
  questions: GeneratedQuestion[];
  targetOrder: number[];
  rejectedTargets: number[];
}

/** Called only with the completed canonical blind assessment of these exact questions. */
export function selectVocabularyRepair(
  questions: GeneratedQuestion[],
  targetOrder: number[],
  feedback: SectionReviewFeedback | undefined,
  structuralTargets: readonly number[] = []
): VocabularyRepairSelection | undefined {
  if (
    !feedback ||
    !feedback.passageAcceptable ||
    feedback.passageFeedback.length ||
    feedback.issues.length ||
    questions.length !== targetOrder.length ||
    new Set(targetOrder).size !== questions.length ||
    targetOrder.some(
      (index) => !Number.isInteger(index) || index < 0 || index >= questions.length
    ) ||
    structuralTargets.some((index) => !targetOrder.includes(index)) ||
    feedback.questions.length !== questions.length ||
    new Set(feedback.questions.map((row) => row.index)).size !== questions.length ||
    feedback.questions.some(
      (row) => !Number.isInteger(row.index) || row.index < 0 || row.index >= questions.length
    )
  )
    return undefined;
  const rejectedTargets = feedback.questions
    .filter(
      (row) =>
        structuralTargets.includes(targetOrder[row.index]) ||
        row.issues.length ||
        row.acceptableOptionIndices.length !== 1 ||
        row.acceptableOptionIndices[0] !== questions[row.index].correctIndex
    )
    .map((row) => targetOrder[row.index]);
  if (!rejectedTargets.length || rejectedTargets.length === questions.length) return undefined;
  return { questions: structuredClone(questions), targetOrder: [...targetOrder], rejectedTargets };
}

export function mergeVocabularyRepair(
  selection: VocabularyRepairSelection,
  replacements: GeneratedQuestion[],
  targetOrder: number[]
): GeneratedQuestion[] {
  if (
    replacements.length !== selection.rejectedTargets.length ||
    targetOrder.length !== replacements.length ||
    new Set(targetOrder).size !== targetOrder.length ||
    targetOrder.some((index) => !selection.rejectedTargets.includes(index))
  )
    throw new Error('Vocabulary repair must replace exactly the rejected target indices.');
  return selection.questions.map((question, index) => {
    const replacement = targetOrder.indexOf(selection.targetOrder[index]);
    return structuredClone(replacement < 0 ? question : replacements[replacement]);
  });
}
