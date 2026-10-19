import type { GeneratedQuestion } from '@/lib/class-generation';

export interface VocabularyCoverageFeedback {
  missingTargets: string[];
  duplicateTargets: string[];
  unexpectedAnswers: Array<{ index: number; answer: string }>;
  invalidContextIndices: number[];
}

export function assessVocabularyCoverage(
  questions: GeneratedQuestion[],
  lemmas: string[]
): { issues: string[]; feedback?: VocabularyCoverageFeedback } {
  const issues: string[] = [];
  const matches = (lemma: string) =>
    questions.filter((q) => q.options[q.correctIndex] === lemma).length;
  const missingTargets = lemmas.filter((lemma) => matches(lemma) === 0);
  const duplicateTargets = lemmas.filter((lemma) => matches(lemma) > 1);
  const unexpectedAnswers = questions.flatMap((q, index) => {
    const answer = q.options[q.correctIndex];
    return lemmas.includes(answer) ? [] : [{ index, answer: answer.slice(0, 300) }];
  });
  if (missingTargets.length || duplicateTargets.length) issues.push('vocabulary_target_coverage');
  const invalidContextIndices = questions.flatMap((q, index) => {
    const gaps = q.question.match(/_+/g) ?? [];
    const invalid =
      gaps.length !== 1 || gaps[0] !== '_____' || q.question.replace(/_+/g, '').trim().length < 8;
    return invalid ? [index] : [];
  });
  if (invalidContextIndices.length) issues.push('vocabulary_context');
  return {
    issues,
    ...(issues.length
      ? {
          feedback: {
            missingTargets: missingTargets.map((lemma) => lemma.slice(0, 300)),
            duplicateTargets: duplicateTargets.map((lemma) => lemma.slice(0, 300)),
            unexpectedAnswers,
            invalidContextIndices,
          },
        }
      : {}),
  };
}
