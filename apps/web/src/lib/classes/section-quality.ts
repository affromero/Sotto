import { z } from 'zod';
import type { GeneratedQuestion } from '../class-generation';

const issueCode = z.enum([
  'ambiguous',
  'incorrect',
  'unnatural',
  'unsupported',
  'level',
  'uncertain',
]);
const verdictSchema = z
  .object({
    passageAcceptable: z.boolean(),
    issues: z.array(issueCode).max(6),
    questions: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(4),
            acceptableOptionIndices: z.array(z.number().int().min(0).max(3)).max(4),
            issues: z.array(issueCode).max(6),
          })
          .strict()
      )
      .min(1)
      .max(5),
  })
  .strict();

export const SECTION_QUALITY_JSON_SCHEMA = {
  name: 'class_section_quality',
  schema: z.toJSONSchema(verdictSchema, { target: 'draft-7' }),
};

export class SectionQualityError extends Error {
  constructor(message = 'Class generation failed its educational quality check.') {
    super(message);
    this.name = 'SectionQualityError';
  }
}

/** The reviewer solves the published questions without seeing the proposed answer key. */
export function sectionReviewInput(questions: GeneratedQuestion[]): string {
  return JSON.stringify({
    passage: questions[0]?.passageText ?? '',
    questions: questions.map((question, index) => ({
      index,
      question: question.question,
      options: question.options,
    })),
  });
}

export function assessSectionReview(
  content: string,
  questions: GeneratedQuestion[],
  immutablePassage: boolean
): string[] {
  let verdict: z.infer<typeof verdictSchema>;
  try {
    verdict = verdictSchema.parse(JSON.parse(content));
  } catch {
    return ['invalid_review'];
  }
  if (!verdict.passageAcceptable && immutablePassage) {
    throw new SectionQualityError(
      'The supplied reading passage failed its language quality check.'
    );
  }
  const indices = new Set(verdict.questions.map((question) => question.index));
  if (
    indices.size !== questions.length ||
    verdict.questions.length !== questions.length ||
    questions.some((_, index) => !indices.has(index))
  )
    return ['invalid_review'];
  const issues = new Set<string>(verdict.issues);
  if (!verdict.passageAcceptable) issues.add('unnatural_passage');
  for (const result of verdict.questions) {
    for (const issue of result.issues) issues.add(issue);
    if (result.acceptableOptionIndices.length !== 1) issues.add('ambiguous');
    else if (result.acceptableOptionIndices[0] !== questions[result.index].correctIndex) {
      issues.add('incorrect_key');
    }
  }
  return [...issues];
}
