import { z } from 'zod';
import type { GeneratedQuestion } from '../class-generation';
import { teachingFailureSchema, type TeachingFailure } from './quality/teaching-failure';

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
    passageFeedback: z
      .array(
        z
          .object({
            quote: z.string().min(1).max(240).regex(/\S/),
            reason: z.string().min(1).max(300).regex(/\S/),
          })
          .strict()
      )
      .max(3),
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

export type SectionReviewFeedback = z.infer<typeof verdictSchema>;

export interface SectionReviewAssessment {
  issues: string[];
  feedback?: SectionReviewFeedback;
}

export class SectionQualityError extends Error {
  readonly blindReviewFailure?: TeachingFailure;
  readonly blindReviewFeedback?: SectionReviewFeedback;

  constructor(
    message = 'Class generation failed its educational quality check.',
    blindReviewFailure?: TeachingFailure,
    blindReviewFeedback?: SectionReviewFeedback
  ) {
    super(message);
    this.name = 'SectionQualityError';
    Object.defineProperty(this, 'blindReviewFailure', {
      value: blindReviewFailure,
      enumerable: false,
    });
    Object.defineProperty(this, 'blindReviewFeedback', {
      value: blindReviewFeedback,
      enumerable: false,
    });
  }
}

function validPassageFeedback(
  verdict: Pick<SectionReviewFeedback, 'passageAcceptable' | 'passageFeedback' | 'issues'>,
  questions: GeneratedQuestion[]
): boolean {
  const passage = questions[0]?.passageText ?? '';
  return verdict.passageAcceptable
    ? verdict.passageFeedback.length === 0
    : passage.length > 0 &&
        verdict.issues.length > 0 &&
        verdict.passageFeedback.length > 0 &&
        verdict.passageFeedback.every((feedback) => passage.includes(feedback.quote));
}

function completeReview(verdict: SectionReviewFeedback, questions: GeneratedQuestion[]): boolean {
  const indices = new Set(verdict.questions.map((question) => question.index));
  return (
    validPassageFeedback(verdict, questions) &&
    indices.size === questions.length &&
    verdict.questions.length === questions.length &&
    questions.every((_, index) => indices.has(index)) &&
    verdict.questions.every(
      (question) =>
        new Set(question.acceptableOptionIndices).size ===
          question.acceptableOptionIndices.length &&
        question.acceptableOptionIndices.every(
          (index) => index < questions[question.index]!.options.length
        )
    )
  );
}

/** Compatibility envelope only. The exact blind verdict is retained separately from its summary. */
export function captureBlindSectionFailure(
  questions: GeneratedQuestion[],
  feedback: SectionReviewFeedback
): TeachingFailure {
  const blindVerdict = verdictSchema.parse(feedback);
  if (!completeReview(blindVerdict, questions))
    throw new Error('Blind review evidence requires complete question identities.');
  const detail = {
    reviewType: 'blind_section',
    verdictType: 'derived_compatibility_summary',
    blindVerdict,
  };
  let candidate = JSON.stringify({
    ...detail,
    transcript: questions[0]?.passageText ?? '',
    questions: questions.map((question) => {
      const content = { ...question };
      delete content.passageText;
      return content;
    }),
  });
  if (Buffer.byteLength(candidate, 'utf8') > 32 * 1024)
    candidate = JSON.stringify({
      ...detail,
      transcript: null,
      questions: null,
      omitted: 'size_limit',
    });
  const verdict = {
    items: blindVerdict.questions.map((question) => {
      const issues = new Set(blindVerdict.issues.concat(question.issues));
      if (!blindVerdict.passageAcceptable) issues.add('unnatural');
      if (question.acceptableOptionIndices.length !== 1) issues.add('ambiguous');
      else if (question.acceptableOptionIndices[0] !== questions[question.index]!.correctIndex)
        issues.add('incorrect');
      const acceptable = issues.size === 0;
      return {
        index: question.index,
        acceptable,
        issues: [
          ...new Set([...issues].map((issue) => (issue === 'ambiguous' ? 'uncertain' : issue))),
        ],
        feedback: acceptable
          ? []
          : [
              'Deterministic blind-review summary, not a teaching-review verdict. Exact blind verdict is in the tagged candidate JSON.',
            ],
      };
    }),
  };
  return teachingFailureSchema.parse({ kind: 'listening', reviews: [{ candidate, verdict }] });
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
  immutablePassage: boolean,
  diagnosticKind?: 'listening'
): SectionReviewAssessment {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { issues: ['invalid_review'] };
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const candidate = raw as Record<string, unknown>;
    const feedback = verdictSchema.shape.passageFeedback.safeParse(candidate.passageFeedback);
    if (!feedback.success)
      throw new SectionQualityError('Blind review passage feedback is malformed.');
    if (
      typeof candidate.passageAcceptable === 'boolean' &&
      !validPassageFeedback(
        {
          passageAcceptable: candidate.passageAcceptable,
          passageFeedback: feedback.data,
          issues: Array.isArray(candidate.issues) ? candidate.issues : [],
        },
        questions
      )
    )
      throw new SectionQualityError(
        'Blind review passage feedback does not match its passage verdict.'
      );
  }
  let verdict: z.infer<typeof verdictSchema>;
  try {
    verdict = verdictSchema.parse(raw);
  } catch {
    return { issues: ['invalid_review'] };
  }
  if (!completeReview(verdict, questions)) return { issues: ['invalid_review'] };
  if (!verdict.passageAcceptable && immutablePassage) {
    throw new SectionQualityError(
      'The supplied reading passage failed its language quality check.',
      diagnosticKind === 'listening' ? captureBlindSectionFailure(questions, verdict) : undefined,
      diagnosticKind === 'listening' ? verdict : undefined
    );
  }
  const issues = new Set<string>(verdict.issues);
  if (!verdict.passageAcceptable) issues.add('unnatural_passage');
  for (const result of verdict.questions) {
    for (const issue of result.issues) issues.add(issue);
    if (result.acceptableOptionIndices.length !== 1) issues.add('ambiguous');
    else if (result.acceptableOptionIndices[0] !== questions[result.index].correctIndex) {
      issues.add('incorrect_key');
    }
  }
  return { issues: [...issues], feedback: issues.size ? verdict : undefined };
}
