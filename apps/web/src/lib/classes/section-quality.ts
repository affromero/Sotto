import { z } from 'zod';
import type { GeneratedQuestion } from '../class-generation';
import { teachingFailureSchema, type TeachingFailure } from './quality/teaching-failure';
import {
  blindReviewIssueSchema,
  blindReviewQuestionsSchema,
  blindReviewResponseSchema,
  buildBlindReviewSourceParts,
} from './quality/blind-review/protocol';

const issueCode = blindReviewIssueSchema;
export const sectionReviewFeedbackSchema = z
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
    questions: blindReviewQuestionsSchema,
  })
  .strict();
const verdictSchema = sectionReviewFeedbackSchema;

export function sectionReviewSchema(questions: GeneratedQuestion[]) {
  const parts = buildBlindReviewSourceParts(questions[0]?.passageText ?? '');
  return {
    name: 'class_section_quality',
    schema: z.toJSONSchema(blindReviewResponseSchema(parts), { target: 'draft-7' }),
  };
}

const blindProtocolFailures = new WeakMap<object, 'invalid_json' | 'schema' | 'coverage'>();

/** Only failures issued while parsing an actual blind response carry diagnostics. */
export function blindReviewProtocolDiagnostic(error: unknown) {
  if (typeof error !== 'object' || error === null) return undefined;
  const reason = blindProtocolFailures.get(error);
  return reason ? { reason, pathCodes: ['response'] as const } : undefined;
}

function invalidBlindReview(reason: 'invalid_json' | 'schema' | 'coverage'): never {
  const error = new SectionQualityError('Blind review returned an invalid protocol response.');
  blindProtocolFailures.set(error, reason);
  throw error;
}

export type SectionReviewFeedback = z.infer<typeof verdictSchema>;

export interface SectionReviewAssessment {
  issues: string[];
  feedback?: SectionReviewFeedback;
  questionIssues?: string[];
  readingPassageReview?: SectionReviewFeedback;
  listeningPassageReview?: SectionReviewFeedback;
}

const issuedReadingPassageReviews = new WeakMap<SectionReviewFeedback, string>();
const issuedListeningPassageReviews = new WeakMap<SectionReviewFeedback, string>();

export function authenticListeningPassageReview(
  feedback: SectionReviewFeedback,
  questions: readonly unknown[]
): boolean {
  return issuedListeningPassageReviews.get(feedback) === JSON.stringify({ questions, feedback });
}

/** Only an unchanged, candidate-bound blind observation may enter adjudication. */
export function authenticReadingPassageReview(
  feedback: SectionReviewFeedback,
  questions: readonly unknown[]
): boolean {
  return issuedReadingPassageReviews.get(feedback) === JSON.stringify({ questions, feedback });
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
  feedback: SectionReviewFeedback,
  kind: 'listening' | 'explanations' = 'listening'
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
  return teachingFailureSchema.parse({ kind, reviews: [{ candidate, verdict }] });
}

/** Render one literal gap without interpreting an option or changing the fixed words. */
export function literalQuestionCompletions(value: unknown): string[] | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    !('question' in value) ||
    typeof value.question !== 'string' ||
    !('options' in value) ||
    !Array.isArray(value.options) ||
    value.options.length !== 4 ||
    !value.options.every((option) => typeof option === 'string') ||
    value.question.match(/_{2,}/g)?.length !== 1
  )
    return undefined;
  const question = value.question;
  return value.options.map((option) => question.replace(/_{2,}/, () => option));
}

/** The reviewer solves the published questions without seeing the proposed answer key. */
export function sectionReviewInput(questions: GeneratedQuestion[]): string {
  return JSON.stringify({
    passage: questions[0]?.passageText ?? '',
    sourceParts: buildBlindReviewSourceParts(questions[0]?.passageText ?? '').map(
      (text, index) => ({
        index,
        text,
      })
    ),
    questions: questions.map((question, index) => {
      const completedOptions = literalQuestionCompletions(question);
      return {
        index,
        question: question.question,
        options: question.options,
        ...(completedOptions ? { completedOptions } : {}),
      };
    }),
  });
}

export function assessSectionReview(
  content: string,
  questions: GeneratedQuestion[],
  immutablePassage: boolean,
  diagnosticKind?: 'listening' | 'reading'
): SectionReviewAssessment {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return invalidBlindReview('invalid_json');
  }
  const sourceParts = buildBlindReviewSourceParts(questions[0]?.passageText ?? '');
  const parsed = blindReviewResponseSchema(sourceParts).safeParse(raw);
  if (!parsed.success) return invalidBlindReview('schema');
  const privateVerdict = parsed.data;
  const verdict: SectionReviewFeedback = {
    passageAcceptable: privateVerdict.passageFindings.length === 0,
    passageFeedback: privateVerdict.passageFindings.map(({ sourcePartIndex, reason }) => ({
      quote: sourceParts[sourcePartIndex]!,
      reason,
    })),
    issues: [
      ...new Set(
        privateVerdict.issues.concat(privateVerdict.passageFindings.map(({ issue }) => issue))
      ),
    ],
    questions: privateVerdict.questions,
  };
  if (!completeReview(verdict, questions)) return invalidBlindReview('coverage');
  if (!verdict.passageAcceptable && immutablePassage && !diagnosticKind) {
    throw new SectionQualityError(
      'The supplied reading passage failed its language quality check.'
    );
  }
  const issues = new Set<string>(verdict.issues);
  const questionIssues = new Set<string>(privateVerdict.issues);
  if (!verdict.passageAcceptable) issues.add('unnatural_passage');
  for (const result of verdict.questions) {
    for (const issue of result.issues) questionIssues.add(issue);
    if (result.acceptableOptionIndices.length !== 1) questionIssues.add('ambiguous');
    else if (result.acceptableOptionIndices[0] !== questions[result.index].correctIndex) {
      questionIssues.add('incorrect_key');
    }
  }
  for (const issue of questionIssues) issues.add(issue);
  if (diagnosticKind && !verdict.passageAcceptable) {
    if (!questionIssues.size)
      (diagnosticKind === 'reading'
        ? issuedReadingPassageReviews
        : issuedListeningPassageReviews
      ).set(verdict, JSON.stringify({ questions, feedback: verdict }));
    return {
      issues: [...issues],
      feedback: verdict,
      questionIssues: [...questionIssues],
      ...(diagnosticKind === 'reading'
        ? { readingPassageReview: questionIssues.size ? undefined : verdict }
        : { listeningPassageReview: questionIssues.size ? undefined : verdict }),
    };
  }
  return { issues: [...issues], feedback: issues.size ? verdict : undefined };
}
