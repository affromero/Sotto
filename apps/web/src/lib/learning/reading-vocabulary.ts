import { createHash } from 'node:crypto';
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
import { logger } from '../logger';
import {
  readingVocabularyResponseSchema,
  ReadingVocabularyProtocolError,
  type ReadingVocabularyProtocolCode,
} from './reading/vocabulary-protocol';

type ReadingAttributionViolation = {
  code: 'dup_lemma' | 'source_form_missing' | 'dup_question_index' | 'out_of_range';
  wordIndex: number;
};

function rejectProtocol(
  code: ReadingVocabularyProtocolCode,
  passageText: string,
  questionIds: readonly string[],
  attributionViolations?: readonly ReadingAttributionViolation[]
): never {
  const serializedIds = JSON.stringify(questionIds);
  logger.error('Reading vocabulary output protocol rejected', {
    code,
    sourceHash: createHash('sha256').update(passageText).digest('hex'),
    questionCount: questionIds.length,
    questionIdsSha256: createHash('sha256').update(serializedIds).digest('hex'),
    ...(attributionViolations ? { attributionViolations } : {}),
    ...(Buffer.byteLength(serializedIds, 'utf8') <= 4096
      ? { questionIds }
      : { questionIdsOmitted: 'size_limit' }),
  });
  throw new ReadingVocabularyProtocolError(code);
}

function parseExtraction(content: string, passageText: string, questionIds: readonly string[]) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    rejectProtocol('malformed_json', passageText, questionIds);
  }
  const extraction = readingVocabularyResponseSchema.safeParse(parsed);
  if (!extraction.success) rejectProtocol('invalid_shape', passageText, questionIds);
  const words = extraction.data.words;
  const attributionViolations: ReadingAttributionViolation[] = [];
  const lemmas = new Set<string>();
  for (const [wordIndex, word] of words.entries()) {
    if (lemmas.has(word.lemma)) attributionViolations.push({ code: 'dup_lemma', wordIndex });
    lemmas.add(word.lemma);
    if (!passageText.includes(word.sourceForm))
      attributionViolations.push({ code: 'source_form_missing', wordIndex });
    if (new Set(word.questionIndices).size !== word.questionIndices.length)
      attributionViolations.push({ code: 'dup_question_index', wordIndex });
    if (word.questionIndices.some((index) => index >= questionIds.length))
      attributionViolations.push({ code: 'out_of_range', wordIndex });
  }
  if (attributionViolations.length)
    rejectProtocol('source_attribution', passageText, questionIds, attributionViolations);
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
  const questionIds = options.questions.map(({ id }) => id);
  const request = {
    ...options,
    text: passageText,
    label: 'COURSE_NOTES' as const,
    usageCategory: 'reading-vocabulary-extraction',
    readingQuestions: options.questions,
  };
  let words = parseExtraction(await requestVocabularyExtraction(request), passageText, questionIds);
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
      questionIds
    );
    if (
      replacement.length !== words.length ||
      replacement.some((word, index) => word.sourceForm !== words[index]!.sourceForm)
    )
      rejectProtocol('replacement_identity', passageText, questionIds);
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
