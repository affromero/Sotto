import { createHash } from 'node:crypto';

/** Order published choices with stable per-question seeds before independent review. */
export function orderQuizChoices<T extends { options: string[]; correctIndex: number }>(
  questions: readonly T[],
  seed: string
): T[] {
  return questions.map((question, index) => {
    const answer = question.options[question.correctIndex];
    const key = (value: string) =>
      createHash('sha256')
        .update(seed + '\0' + index + '\0' + value)
        .digest('hex');
    const options = [...question.options].sort((left, right) =>
      key(left).localeCompare(key(right))
    );
    return { ...question, options, correctIndex: options.indexOf(answer) };
  });
}
