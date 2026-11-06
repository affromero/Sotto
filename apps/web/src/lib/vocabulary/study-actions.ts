import { vocabularyStudyActionSchema, vocabularyStudyReceiptSchema } from '@sotto/shared';
import { prismaUnfiltered as prisma } from '../prisma';
import { applyReviewOutcome } from '../knowledge-graph';
import { sottoTransaction } from '../sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '../sidedoor/credentials/runtime/provider-execution';
import {
  assertVocabularyStudyOwner,
  publicVocabularyStudy,
  readFlashcardRatings,
  vocabularyAnswerMatches,
  vocabularyStudyStateSchema,
  VocabularyStudyConflict,
  VocabularyStudyNotFound,
  VocabularyStudyUnavailable,
} from './study-state';

/** The first response owns feedback and its review event in the same locked transaction. */
export async function actOnVocabularyStudy(
  sessionId: string,
  execution: SottoProviderExecution,
  input: unknown
) {
  const action = vocabularyStudyActionSchema.parse(input);
  return sottoTransaction(
    prisma,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== execution.userId)
        throw new VocabularyStudyNotFound('Vocabulary study not found.');
      await database.$queryRaw`SELECT id FROM "PracticeSession" WHERE id = ${sessionId} FOR UPDATE`;
      const session = await database.practiceSession.findFirst({
        where: { id: sessionId, course: { userId: actor.userId } },
      });
      if (!session?.vocabularyStudy)
        throw new VocabularyStudyNotFound('Vocabulary study not found.');
      const state = vocabularyStudyStateSchema.parse(session.vocabularyStudy);
      assertVocabularyStudyOwner(state, session, actor.userId);
      await database.$queryRaw`SELECT id FROM "Course" WHERE id = ${session.courseId} FOR UPDATE`;
      const ratings = await readFlashcardRatings(database, state, sessionId);
      const current = () => publicVocabularyStudy(state, session, ratings);
      if (action.action === 'COMPLETE' && session.status === 'COMPLETED') return current();
      if (!['ACTIVE', 'COMPLETED'].includes(session.status))
        throw new VocabularyStudyConflict('This study no longer accepts responses.');

      if (action.action !== 'COMPLETE') {
        const card = state.cards.find((item) => item.id === action.itemId);
        if (!card) throw new VocabularyStudyNotFound('Study card not found.');
        if (card.response) {
          const repeatedAnswer =
            action.action === 'ANSWER' &&
            card.response.outcome === 'ANSWERED' &&
            card.response.answer === action.answer;
          const repeatedReveal = action.action === 'REVEAL' && card.response.outcome !== 'ANSWERED';
          const repeatedRating = action.action === 'RATE' && ratings.get(card.id) === action.rating;
          if (repeatedAnswer || repeatedReveal || repeatedRating) return current();
          throw new VocabularyStudyConflict(
            'This card already has feedback. Continue with the next card.'
          );
        }
      }
      if (session.status !== 'ACTIVE' || action.expectedRevision !== session.progressRevision)
        throw new VocabularyStudyConflict(
          'Study changed in another tab. Check saved progress before continuing.'
        );
      if (action.action === 'COMPLETE') {
        if (state.cards.some((card) => !card.response))
          throw new VocabularyStudyConflict('Review every card before finishing this study.');
        const reviewed = state.cards.filter((card) => card.response?.outcome !== 'STUDIED');
        const correct = reviewed.filter((card) => card.response?.correct === true).length;
        const receipt = vocabularyStudyReceiptSchema.parse({
          version: 1,
          type: 'VOCABULARY_STUDY',
          mode: state.mode,
          score: reviewed.length ? correct / reviewed.length : null,
          correct,
          total: state.cards.length,
          reviewed: reviewed.length,
          studied: state.cards.length - reviewed.length,
          completedAt: new Date().toISOString(),
        });
        const completed = await database.practiceSession.update({
          where: { id: sessionId },
          data: {
            status: 'COMPLETED',
            score: receipt.score,
            completedAt: new Date(receipt.completedAt),
            submissionResult: receipt,
            progressRevision: { increment: 1 },
          },
        });
        return publicVocabularyStudy(state, completed, ratings);
      }

      const card = state.cards.find((item) => item.id === action.itemId)!;
      if (action.action === 'RATE' && state.mode !== 'FLASHCARDS')
        throw new VocabularyStudyConflict('Self-ratings are only available for flashcards.');
      if (action.action === 'ANSWER' && state.mode === 'FLASHCARDS')
        throw new VocabularyStudyConflict(
          'Flashcards are study. Start a separate recall check to assess mastery.'
        );
      if (state.mode === 'LISTENING_RECALL' && !card.listeningPresentedAt)
        throw new VocabularyStudyUnavailable(
          'Play the local pronunciation before checking this answer.'
        );
      const word = await database.learnerVocab.findFirst({
        where: { id: card.wordId, courseId: session.courseId, lemma: card.lemma },
        select: { id: true },
      });
      if (!word)
        throw new VocabularyStudyUnavailable('This dictionary word changed or was removed.');
      const now = new Date();
      const correct =
        action.action === 'RATE'
          ? action.rating === 'KNOWN'
          : action.action === 'ANSWER' && state.mode !== 'FLASHCARDS'
            ? vocabularyAnswerMatches(card, state.mode, action.answer, state.nativeLang)
            : false;
      card.response = {
        outcome:
          state.mode === 'FLASHCARDS'
            ? 'STUDIED'
            : action.action === 'ANSWER'
              ? 'ANSWERED'
              : 'REVEALED',
        answer: action.action === 'ANSWER' ? action.answer : '',
        correct: state.mode === 'FLASHCARDS' ? null : correct,
        reviewedAt: now.toISOString(),
      };
      await database.learnerVocab.updateMany({
        where: { id: card.wordId, courseId: session.courseId, introducedAt: null },
        data: { introducedAt: now },
      });
      if (action.action === 'RATE') {
        await database.flashcardRating.create({
          data: {
            practiceSessionId: sessionId,
            courseId: session.courseId,
            cardId: card.id,
            rating: action.rating,
            ratedAt: now,
          },
        });
      }
      if (state.mode !== 'FLASHCARDS' || action.action === 'RATE')
        await applyReviewOutcome(
          session.courseId,
          [card.lemma],
          [],
          correct ? 1 : 0,
          0,
          now,
          database,
          {
            source: { practiceSessionId: sessionId, attempt: 1 },
            assessment: state.mode === 'FLASHCARDS' ? 'FLASHCARD_SELF_ASSESSMENT' : state.mode,
            questionIdsByTarget: new Map([[`vocab:${card.lemma}`, [card.id]]]),
          }
        );
      const saved = await database.practiceSession.update({
        where: { id: sessionId },
        data: { vocabularyStudy: state, progressRevision: { increment: 1 } },
      });
      return publicVocabularyStudy(
        state,
        saved,
        await readFlashcardRatings(database, state, sessionId)
      );
    },
    { signal: execution.signal }
  );
}
