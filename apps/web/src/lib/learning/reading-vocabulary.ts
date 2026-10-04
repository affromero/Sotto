import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readingVocabularySchema, type ReadingVocabulary } from '@sotto/shared';
import { assertReadingQuestionKeys, requestVocabularyExtraction } from '../live-vocab';
import { resolveCapturedLearningAi } from '../learning-ai';
import { createAIProvider } from '../providers/ai';
import {
  reviewTeachingContent,
  TeachingQualityRejectionError,
} from '../classes/quality/teaching-quality';
import { combineTeachingFailures } from '../classes/quality/teaching-failure';
import type { SottoProviderExecution } from '../sidedoor/credentials/runtime/provider-execution';
import type { LearningDatabase } from './database';
import { LearningIncompleteError } from './session-evaluation';
import { applyReviewOutcome } from '../knowledge-graph';

const extractionSchema = z
  .array(
    z
      .object({
        lemma: z.string().trim().min(1),
        gloss: z.string().trim().min(1),
        pos: z.string().trim().min(1),
        sourceForm: z.string().min(1),
        questionIndices: z.array(z.number().int().nonnegative()),
      })
      .strict()
  )
  .min(1)
  .max(12);

function parseExtraction(content: string, passageText: string, questionCount: number) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Reading vocabulary extraction returned malformed JSON.');
  }
  const extraction = extractionSchema.safeParse(parsed);
  if (!extraction.success)
    throw new Error('Reading vocabulary extraction returned invalid vocabulary.');
  const words = extraction.data;
  if (
    new Set(words.map((word) => word.lemma)).size !== words.length ||
    words.some(
      (word) =>
        !passageText.includes(word.sourceForm) ||
        new Set(word.questionIndices).size !== word.questionIndices.length ||
        word.questionIndices.some((index) => index >= questionCount)
    )
  )
    throw new Error(
      'Reading vocabulary attribution does not match the supplied passage and questions.'
    );
  return words;
}

export async function extractReadingVocabulary(options: {
  userId: string;
  execution: SottoProviderExecution;
  nativeLang: string;
  targetLang: string;
  level: string;
  questions: readonly {
    id: string;
    question: string;
    options: readonly string[];
    correctIndex: number;
    passageText?: string | null;
  }[];
}): Promise<ReadingVocabulary> {
  assertReadingQuestionKeys(options.questions);
  const passages = new Set(
    options.questions.map((question) => question.passageText).filter(Boolean)
  );
  if (
    passages.size !== 1 ||
    options.questions.some((question) => !question.passageText) ||
    new Set(options.questions.map((question) => question.id)).size !== options.questions.length
  )
    throw new Error('Reading vocabulary requires one exact passage and unique question IDs.');
  const passageText = [...passages][0]!;
  const request = {
    ...options,
    text: passageText,
    label: 'COURSE_NOTES' as const,
    usageCategory: 'reading-vocabulary-extraction',
    readingQuestions: options.questions,
  };
  let words = parseExtraction(
    await requestVocabularyExtraction(request),
    passageText,
    options.questions.length
  );
  const ai = await resolveCapturedLearningAi(options.userId, options.execution);
  const provider = createAIProvider(ai.provider);
  let reviewOffset = 0;
  async function reviewWords(candidate: typeof words) {
    for (let offset = 0; offset < candidate.length; offset += 5) {
      reviewOffset = offset;
      await reviewTeachingContent({
        ...options,
        ai,
        provider,
        kind: 'vocabulary',
        items: candidate.slice(offset, offset + 5).map((word) => ({
          ...word,
          passageText,
          assessedQuestions: word.questionIndices.map((index) => options.questions[index]),
        })),
      });
    }
  }
  try {
    await reviewWords(words);
  } catch (error) {
    if (!(error instanceof TeachingQualityRejectionError)) throw error;
    const replacement = parseExtraction(
      await requestVocabularyExtraction({
        ...request,
        readingCorrection: {
          words,
          issues: error.issues,
          feedback: error.feedback.map(({ index, feedback }) => ({
            index: index + reviewOffset,
            feedback,
          })),
        },
      }),
      passageText,
      options.questions.length
    );
    if (
      replacement.length !== words.length ||
      replacement.some((word, index) => word.sourceForm !== words[index]!.sourceForm)
    )
      throw new Error('Reading vocabulary correction changed the original source identities.');
    try {
      await reviewWords(replacement);
    } catch (replacementError) {
      if (!(replacementError instanceof TeachingQualityRejectionError)) throw replacementError;
      throw new TeachingQualityRejectionError(
        replacementError.issues,
        replacementError.feedback,
        combineTeachingFailures(error.teachingFailure, replacementError.teachingFailure)
      );
    }
    words = replacement;
  }
  return readingVocabularySchema.parse({
    sourceHash: createHash('sha256').update(passageText).digest('hex'),
    passageText,
    words: words.map(({ questionIndices, ...word }) => ({
      ...word,
      questionIds: questionIndices.map((index) => options.questions[index]!.id),
    })),
  });
}

/** Only questions that assess an extracted word may advance that word's SRS. */
export async function reviewReadingVocabulary(
  database: LearningDatabase,
  courseId: string,
  snapshot: unknown,
  answers: ReadonlyMap<string, boolean>,
  now: Date
): Promise<Set<string>> {
  if (snapshot == null) return new Set();
  const vocabulary = readingVocabularySchema.parse(snapshot);
  const assessed = new Set<string>();
  for (const word of vocabulary.words) {
    if (!word.questionIds.length || word.questionIds.some((id) => !answers.has(id))) continue;
    const score = word.questionIds.filter((id) => answers.get(id)).length / word.questionIds.length;
    await applyReviewOutcome(courseId, [word.lemma], [], score, 0, now, database);
    assessed.add(word.lemma);
  }
  return assessed;
}

/** Match preserved extraction to the exact assessed passage and course memory. */
export async function assertStoredReadingVocabulary(
  database: LearningDatabase,
  courseId: string,
  value: unknown,
  questions: readonly { id: string; passageText?: string | null }[]
) {
  const extraction = readingVocabularySchema.safeParse(value);
  if (!extraction.success)
    throw new LearningIncompleteError('Reading vocabulary extraction is incomplete.', ['READING']);
  const snapshot = extraction.data;
  const ids = new Set(questions.map((question) => question.id));
  if (
    questions.some((question) => question.passageText !== snapshot.passageText) ||
    snapshot.sourceHash !== createHash('sha256').update(snapshot.passageText).digest('hex') ||
    new Set(snapshot.words.map((word) => word.lemma)).size !== snapshot.words.length ||
    snapshot.words.some(
      (word) =>
        !snapshot.passageText.includes(word.sourceForm) ||
        new Set(word.questionIds).size !== word.questionIds.length ||
        word.questionIds.some((id) => !ids.has(id))
    )
  )
    throw new LearningIncompleteError(
      'Reading vocabulary does not match the current passage and questions.',
      ['READING']
    );
  const words = await database.learnerVocab.findMany({
    where: { courseId, lemma: { in: snapshot.words.map((word) => word.lemma) } },
    select: { lemma: true },
  });
  if (snapshot.words.some((word) => !words.some((stored) => stored.lemma === word.lemma)))
    throw new LearningIncompleteError('Reading vocabulary is missing from this course memory.', [
      'READING',
    ]);
}
