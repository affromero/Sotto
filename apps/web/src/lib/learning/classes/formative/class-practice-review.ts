import type { Prisma } from '@/generated/prisma/client';
import { classTargetsFromSeed } from '@/lib/classes/lesson/class-targets';
import { applyReviewOutcome } from '@/lib/knowledge-graph';
import {
  recordClassAssessmentObservations,
  type ClassEvidenceSection,
} from '@/lib/learning-map/evidence/session';
import { reviewReadingVocabulary } from '../../reading-vocabulary';

type GradedAnswer = {
  sectionId: string;
  questionId: string;
  selectedIndex: number;
  isCorrect: boolean;
};

/** Apply the existing learning review from formative work, within the submission transaction. */
export async function applyClassPracticeReview(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    courseId: string;
    userId: string;
    attempt: number;
    adaptiveSeed: Prisma.JsonValue;
    readingVocabulary: Prisma.JsonValue;
    lesson: { targetVocab: Prisma.JsonValue; grammarPoints: Prisma.JsonValue };
    sections: readonly ClassEvidenceSection[];
    answers: readonly { questionId: string; selectedIndex: number }[];
    graded: readonly GradedAnswer[];
    previousAnswers: readonly GradedAnswer[];
    history: readonly Prisma.JsonValue[];
    sectionResults: readonly { id: string; skill: string; score: number }[];
    now: Date;
  }
) {
  const { classId, courseId, userId, attempt, sections, answers, graded, sectionResults, now } =
    input;
  const targets = classTargetsFromSeed(input.adaptiveSeed);
  const vocab = targets?.vocab ?? (input.lesson.targetVocab as Array<{ lemma: string }>);
  const grammar = targets?.grammarPoints ?? (input.lesson.grammarPoints as string[]);
  const canonicalGrammar = await recordClassAssessmentObservations(database, {
    courseId,
    userId,
    classId,
    sections,
    answers,
  });
  const previousEvidence = [
    input.previousAnswers,
    ...input.history.flatMap((entry) => {
      if (
        !entry ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        !Array.isArray(entry.answers)
      )
        return [];
      return [entry.answers];
    }),
  ];
  const newlyReviewed = (skill: 'READING' | 'GRAMMAR') => {
    const sectionId = sectionResults.find((section) => section.skill === skill)?.id;
    const current = graded.filter((answer) => answer.sectionId === sectionId);
    return (
      current.length > 0 &&
      !previousEvidence.some((previous) =>
        current.every((answer) =>
          previous.some(
            (saved) =>
              saved &&
              typeof saved === 'object' &&
              !Array.isArray(saved) &&
              'sectionId' in saved &&
              saved.sectionId === answer.sectionId &&
              'questionId' in saved &&
              saved.questionId === answer.questionId &&
              'selectedIndex' in saved &&
              saved.selectedIndex === answer.selectedIndex &&
              'isCorrect' in saved &&
              saved.isCorrect === answer.isCorrect
          )
        )
      )
    );
  };
  const reviewReading = newlyReviewed('READING');
  const reviewGrammar = newlyReviewed('GRAMMAR');
  const source = { classId, attempt };
  const assessedReading = reviewReading
    ? await reviewReadingVocabulary(
        database,
        courseId,
        input.readingVocabulary,
        new Map(graded.map((answer) => [answer.questionId, answer.isCorrect])),
        now,
        source
      )
    : new Set<string>();
  const reading = sectionResults.find((section) => section.skill === 'READING');
  const grammarSection = sectionResults.find((section) => section.skill === 'GRAMMAR');
  if (!reading || !grammarSection)
    throw new Error('Class practice review requires reading and grammar.');
  await applyReviewOutcome(
    courseId,
    reviewReading && !input.readingVocabulary && Array.isArray(vocab)
      ? vocab.map((item) => item.lemma).filter((lemma) => !assessedReading.has(lemma))
      : [],
    reviewGrammar && Array.isArray(grammar)
      ? grammar.filter((key) => !canonicalGrammar.has(key))
      : [],
    reading.score,
    grammarSection.score,
    now,
    database,
    {
      source,
      assessment: 'SECTION_AGGREGATE',
      questionIdsByTarget: new Map([
        ...(Array.isArray(vocab)
          ? vocab.map(
              (item) =>
                [
                  `vocab:${item.lemma}`,
                  graded
                    .filter((answer) => answer.sectionId === reading.id)
                    .map((answer) => answer.questionId),
                ] as const
            )
          : []),
        ...(Array.isArray(grammar)
          ? grammar.map(
              (key) =>
                [
                  `grammar:${key}`,
                  graded
                    .filter((answer) => answer.sectionId === grammarSection.id)
                    .map((answer) => answer.questionId),
                ] as const
            )
          : []),
      ]),
    }
  );
}
