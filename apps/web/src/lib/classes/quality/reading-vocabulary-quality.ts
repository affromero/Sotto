import { z } from 'zod';
import type { CapturedLearningAi } from '../../learning-ai';
import type { AIProvider } from '../../providers/ai';
import { classLanguagePolicy } from '../class-language-policy';
import { logger } from '../../logger';
import { captureTeachingFailure, teachingQualityVerdictSchema } from './teaching-failure';
import {
  assertReadingReviewQuestion,
  reviewReadingVocabularyCounterfactual,
  type ReadingReviewQuestion,
} from './reading-vocabulary-counterfactual';
import {
  requestTeachingReview,
  ReviewerProtocolError,
  TeachingQualityRejectionError,
} from './teaching-quality';

const metadataSchema = teachingQualityVerdictSchema.shape.items.element.omit({ index: true });
const decisionSchema = z
  .object({
    questionIndex: z.number().int().min(0),
    canAnswerWithoutWord: z.boolean(),
    reasoning: z.string().trim().min(1).max(300),
  })
  .strict();
function readingVerdictSchema(maxAssociations: number) {
  return z
    .object({
      items: z
        .array(
          z
            .object({
              index: z.number().int().min(0).max(4),
              metadata: metadataSchema,
              associations: z.array(decisionSchema).max(maxAssociations),
            })
            .strict()
        )
        .min(1)
        .max(5),
    })
    .strict();
}

type ReadingReviewItem = {
  lemma: string;
  gloss: string;
  pos: string;
  sourceForm: string;
  questionIndices: readonly number[];
  passageText: string;
  assessedQuestions: readonly ReadingReviewQuestion[];
};

/** Admit word quality and each proposed mastery association independently. */
export async function reviewReadingVocabularyContent(options: {
  ai: CapturedLearningAi;
  provider: AIProvider;
  userId: string;
  level: string;
  nativeLang: string;
  targetLang: string;
  items: readonly ReadingReviewItem[];
}): Promise<number[][]> {
  if (
    options.items.some(
      (item) =>
        item.assessedQuestions.length !== item.questionIndices.length ||
        new Set(item.questionIndices).size !== item.questionIndices.length
    )
  )
    throw new ReviewerProtocolError();
  for (const item of options.items)
    for (const question of item.assessedQuestions) assertReadingReviewQuestion(question);
  const verdictSchema = readingVerdictSchema(
    Math.max(0, ...options.items.map((item) => item.questionIndices.length))
  );
  const jsonSchema = {
    name: 'reading_vocabulary_quality',
    schema: z.toJSONSchema(verdictSchema, { target: 'draft-7' }),
  };
  const content = await requestTeachingReview({
    ...options,
    prompt: 'class/review-reading-vocabulary.md',
    jsonSchema,
    variables: {
      LEVEL: options.level,
      NATIVE: options.nativeLang,
      TARGET: options.targetLang,
      LANGUAGE_POLICY: classLanguagePolicy(options),
      REVIEW_SCHEMA: JSON.stringify(jsonSchema.schema),
    },
  });
  let parsed: z.infer<typeof verdictSchema>;
  try {
    parsed = verdictSchema.parse(JSON.parse(content));
  } catch {
    throw new ReviewerProtocolError();
  }
  if (
    parsed.items.length !== options.items.length ||
    new Set(parsed.items.map((item) => item.index)).size !== options.items.length ||
    parsed.items.some((item) => {
      const source = options.items[item.index];
      if (!source) return true;
      const { metadata, associations } = item;
      return (
        (metadata.acceptable
          ? metadata.issues.length > 0 || metadata.feedback.length > 0
          : metadata.issues.length === 0 || metadata.feedback.length === 0) ||
        associations.length !== source.questionIndices.length ||
        new Set(associations.map((decision) => decision.questionIndex)).size !==
          associations.length ||
        associations.some((decision) => !source.questionIndices.includes(decision.questionIndex))
      );
    })
  )
    throw new ReviewerProtocolError();
  const metadataVerdict = {
    items: parsed.items.map(({ index, metadata }) => ({ index, ...metadata })),
  };
  if (metadataVerdict.items.some((item) => !item.acceptable)) {
    const issues = [...new Set(metadataVerdict.items.flatMap((item) => item.issues))];
    throw new TeachingQualityRejectionError(
      issues,
      metadataVerdict.items
        .filter((item) => !item.acceptable)
        .map(({ index, feedback }) => ({ index, feedback })),
      captureTeachingFailure(
        'vocabulary',
        options.items.map((item, index) => ({
          ...item,
          reviewContract: 'reading_metadata_and_associations',
          outerVerdict: 'derived_metadata_only',
          actualReview: parsed.items.find((review) => review.index === index),
        })),
        metadataVerdict
      )
    );
  }
  const admitted: number[][] = [];
  for (const [index, source] of options.items.entries()) {
    const verdict = parsed.items.find((item) => item.index === index)!;
    const supported = source.questionIndices.filter((questionIndex) =>
      verdict.associations.some(
        (decision) => decision.questionIndex === questionIndex && !decision.canAnswerWithoutWord
      )
    );
    admitted.push(
      await reviewReadingVocabularyCounterfactual({
        ai: options.ai,
        provider: options.provider,
        userId: options.userId,
        level: options.level,
        targetLang: options.targetLang,
        lemma: source.lemma,
        sourceForm: source.sourceForm,
        passageText: source.passageText,
        questions: supported.map((questionIndex) => ({
          questionIndex,
          question: source.assessedQuestions[source.questionIndices.indexOf(questionIndex)]!,
        })),
      })
    );
  }
  const denied = options.items.flatMap((source, index) =>
    source.questionIndices
      .filter((questionIndex) => !admitted[index]!.includes(questionIndex))
      .map((questionIndex) => ({ batchWordIndex: index, questionIndex, supported: false as const }))
  );
  if (denied.length)
    logger.info('Reading vocabulary associations not admitted', {
      deniedCount: denied.length,
      denied: denied.slice(0, 60),
      omittedCount: Math.max(0, denied.length - 60),
    });
  return admitted;
}
