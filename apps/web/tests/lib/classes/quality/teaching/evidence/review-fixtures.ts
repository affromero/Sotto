import type { TeachingFinding } from '@/lib/classes/quality/teaching-review-protocol';

export const finding = (
  fieldPath: string[],
  quote: string,
  defect = 'Unsupported teaching claim.'
): TeachingFinding => ({
  issue: 'unsupported',
  fieldPath,
  quote,
  rule: 'Preserve supplied facts.',
  defect,
  correction: 'Use only the supplied facts.',
  counterexample: null,
});
export const accepted = (index: number, criticisms: TeachingFinding[] = []) => ({
  index,
  acceptable: true,
  issues: [],
  feedback: [],
  findings: [],
  criticDecisions: criticisms.map((entry, findingIndex) => ({
    findingIndex,
    decision: 'dismissed',
    reason: `The quoted ${entry.fieldPath.join('.')} supports the task.`,
  })),
});
export const rejected = (
  index: number,
  entry: TeachingFinding,
  criticisms: TeachingFinding[] = []
) => ({
  index,
  acceptable: false,
  issues: [entry.issue],
  feedback: [entry.defect],
  findings: [entry],
  criticDecisions: criticisms.map((value, findingIndex) => ({
    findingIndex,
    decision: value.quote === entry.quote ? 'supported' : 'dismissed',
    reason: 'Checked against the supplied facts.',
  })),
});
