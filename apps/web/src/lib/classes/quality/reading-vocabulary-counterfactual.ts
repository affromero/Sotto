import { z } from 'zod';
import type { CapturedLearningAi } from '../../learning-ai';
import type { AIProvider } from '../../providers/ai';
import { requestTeachingReview, ReviewerProtocolError } from './teaching-quality';

export type ReadingReviewQuestion = {
  question: string;
  options: readonly string[];
  correctIndex: number;
};

export function assertReadingReviewQuestion(question: ReadingReviewQuestion): void {
  if (
    typeof question?.question !== 'string' ||
    !question.question.trim() ||
    !Array.isArray(question.options) ||
    question.options.length < 2 ||
    question.options.some((option) => typeof option !== 'string' || !option.trim()) ||
    !Number.isSafeInteger(question.correctIndex) ||
    question.correctIndex < 0 ||
    question.correctIndex >= question.options.length
  )
    throw new ReviewerProtocolError();
}

const marker = '[WORD]';
const boundaries = '[\\p{L}\\p{M}\\p{N}_]';

function knownFormMask(lemma: string, sourceForm: string) {
  const forms = [...new Set([lemma, sourceForm].map((form) => form.normalize('NFC').trim()))];
  if (forms.some((form) => !form || form.includes(marker))) throw new ReviewerProtocolError();
  const alternatives = forms
    .sort((left, right) => right.length - left.length)
    .map((form) => form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const pattern = new RegExp(`(?<!${boundaries})(?:${alternatives})(?!${boundaries})`, 'giu');
  return (text: string) => {
    if (text.includes(marker)) throw new ReviewerProtocolError();
    return text.normalize('NFC').replace(pattern, marker);
  };
}

function counterfactualSchema(maxQuestions: number, maxOptions: number) {
  const base = {
    questionIndex: z.number().int().nonnegative(),
    reasoning: z.string().trim().min(1).max(300),
  };
  return z
    .object({
      decisions: z
        .array(
          z.union([
            z
              .object({
                ...base,
                decision: z.literal('ANSWERABLE_WITHOUT_WORD'),
                answerIndex: z
                  .number()
                  .int()
                  .min(0)
                  .max(maxOptions - 1),
              })
              .strict(),
            z
              .object({
                ...base,
                decision: z.enum(['WORD_MEANING_REQUIRED', 'UNCERTAIN']),
                answerIndex: z.null(),
              })
              .strict(),
          ])
        )
        .min(1)
        .max(maxQuestions),
    })
    .strict();
}

/** Hide one word in one isolated request; neighboring word contexts would reveal it. */
export async function reviewReadingVocabularyCounterfactual(options: {
  ai: CapturedLearningAi;
  provider: AIProvider;
  userId: string;
  level: string;
  targetLang: string;
  lemma: string;
  sourceForm: string;
  passageText: string;
  questions: readonly { questionIndex: number; question: ReadingReviewQuestion }[];
}): Promise<number[]> {
  if (!options.questions.length) return [];
  const mask = knownFormMask(options.lemma, options.sourceForm);
  const passageText = mask(options.passageText);
  if (!passageText.includes(marker)) throw new ReviewerProtocolError();
  const questions = options.questions.map(({ questionIndex, question }) => {
    assertReadingReviewQuestion(question);
    return {
      questionIndex,
      question: mask(question.question),
      options: question.options.map(mask),
    };
  });
  const schema = counterfactualSchema(
    questions.length,
    Math.max(...questions.map((question) => question.options.length))
  );
  const jsonSchema = {
    name: 'reading_vocabulary_counterfactual',
    schema: z.toJSONSchema(schema, { target: 'draft-7' }),
  };
  const content = await requestTeachingReview({
    ai: options.ai,
    provider: options.provider,
    userId: options.userId,
    prompt: 'class/review-reading-vocabulary-counterfactual.md',
    variables: {
      LEVEL: options.level,
      TARGET: options.targetLang,
      REVIEW_SCHEMA: JSON.stringify(jsonSchema.schema),
    },
    items: [{ passageText, questions }],
    jsonSchema,
  });
  let parsed: z.infer<typeof schema>;
  try {
    parsed = schema.parse(JSON.parse(content));
  } catch {
    throw new ReviewerProtocolError();
  }
  if (
    parsed.decisions.length !== questions.length ||
    new Set(parsed.decisions.map((decision) => decision.questionIndex)).size !== questions.length ||
    parsed.decisions.some((decision) => {
      const question = questions.find(
        (candidate) => candidate.questionIndex === decision.questionIndex
      );
      return (
        !question ||
        (decision.decision === 'ANSWERABLE_WITHOUT_WORD' &&
          decision.answerIndex >= question.options.length)
      );
    })
  )
    throw new ReviewerProtocolError();
  return options.questions
    .filter(({ questionIndex }) =>
      parsed.decisions.some(
        (decision) =>
          decision.questionIndex === questionIndex && decision.decision === 'WORD_MEANING_REQUIRED'
      )
    )
    .map(({ questionIndex }) => questionIndex);
}
