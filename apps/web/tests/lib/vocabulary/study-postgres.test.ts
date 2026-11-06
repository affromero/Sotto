// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { startVocabularyStudy } from '@/lib/vocabulary/study-admission';
import { actOnVocabularyStudy } from '@/lib/vocabulary/study-actions';
import { getDueItems } from '@/lib/knowledge-graph';
import { resumePractice } from '@/lib/practice/resume';
import { saveLearningProgress } from '@/lib/learning/progress';
import { submitPractice } from '@/lib/practice/submission';
import { readDictionary } from '@/lib/vocabulary/dictionary';
import { authorizedLearnerExecution } from '../../helpers/runtime/provider-execution';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('owned dictionary study against PostgreSQL', () => {
  let instance: SharedTestInstance;
  let userId: string;
  let courseId: string;
  let wordId: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('dictionary_study');
    boundary.database = instance.database;
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });
  beforeEach(async () => {
    ({ ownerId: userId } = await instance.reset());
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Study fixture' },
      update: {},
    });
    courseId = (
      await instance.database.course.create({
        data: {
          userId,
          curriculumId: curriculum.id,
          nativeLang: 'en',
          targetLang: 'de',
          vocabularySupport: 'MEANING_RECALL',
        },
      })
    ).id;
    wordId = (
      await instance.database.learnerVocab.create({
        data: {
          courseId,
          lemma: 'Bahnhof',
          translation: 'station',
          acceptedMeanings: ['train station'],
        },
      })
    ).id;
    await instance.database.learnerVocab.create({
      data: { courseId, lemma: 'Fahrkarte', translation: 'ticket' },
    });
  });

  const execution = () => authorizedLearnerExecution(userId);
  const start = (mode: 'FLASHCARDS' | 'MEANING_RECALL' | 'WORD_RECALL' = 'MEANING_RECALL') =>
    startVocabularyStudy(courseId, execution(), {
      requestId: randomUUID(),
      mode,
      wordIds: [wordId],
    });
  const answer = (sessionId: string, itemId: string, value: string, revision = 0) =>
    actOnVocabularyStudy(sessionId, execution(), {
      action: 'ANSWER',
      itemId,
      answer: value,
      expectedRevision: revision,
    });

  it('starts without AI configuration or changing exposure, mastery, or due history', async () => {
    const before = await instance.database.learnerVocab.findUniqueOrThrow({
      where: { id: wordId },
    });
    expect((await getDueItems(courseId)).vocab).toEqual([]);
    const session = await startVocabularyStudy(courseId, execution(), { requestId: randomUUID() });
    expect(session.mode).toBe('MEANING_RECALL');
    expect(session.cards).toHaveLength(2);
    expect(JSON.stringify(session)).not.toContain('train station');
    expect(
      await instance.database.learnerVocab.findUniqueOrThrow({ where: { id: wordId } })
    ).toMatchObject({
      mastery: 0,
      reps: 0,
      lastReviewed: null,
      introducedAt: null,
      dueAt: before.dueAt,
    });
    expect(await instance.database.learnerReviewEvent.count({ where: { courseId } })).toBe(0);
  });

  it('freezes accepted meanings and journals the first recalled answer once', async () => {
    const session = await start();
    await instance.database.learnerVocab.update({
      where: { id: wordId },
      data: { acceptedMeanings: ['railway station'] },
    });
    const first = await answer(session.sessionId, session.cards[0]!.id, 'train station');
    expect(first.cards[0]!.feedback).toMatchObject({ correct: true, answer: 'train station' });
    expect(await answer(session.sessionId, session.cards[0]!.id, 'train station')).toEqual(first);
    await expect(
      answer(session.sessionId, session.cards[0]!.id, 'railway station', 1)
    ).rejects.toThrow('already has feedback');
    const events = await instance.database.learnerReviewEvent.findMany({ where: { courseId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      assessment: 'MEANING_RECALL',
      practiceSessionId: session.sessionId,
      vocabId: wordId,
      quality: 1,
      questionIds: [session.cards[0]!.id],
    });
    const word = await instance.database.learnerVocab.findUniqueOrThrow({ where: { id: wordId } });
    expect(word.reps).toBe(1);
    expect(word.mastery).toBeGreaterThan(0);
    expect(word.introducedAt).not.toBeNull();
    const completed = await actOnVocabularyStudy(session.sessionId, execution(), {
      action: 'COMPLETE',
      expectedRevision: first.progressRevision,
    });
    expect(completed.receipt).toMatchObject({
      score: 1,
      correct: 1,
      total: 1,
      reviewed: 1,
      studied: 0,
    });
    expect(
      await actOnVocabularyStudy(session.sessionId, execution(), {
        action: 'COMPLETE',
        expectedRevision: 0,
      })
    ).toEqual(completed);
    expect(await instance.database.learnerReviewEvent.count({ where: { courseId } })).toBe(1);
  });

  it('serializes simultaneous answers without duplicate review evidence', async () => {
    const session = await start();
    const responses = await Promise.all([
      answer(session.sessionId, session.cards[0]!.id, 'station'),
      answer(session.sessionId, session.cards[0]!.id, 'station'),
    ]);
    expect(responses[0]).toEqual(responses[1]);
    expect(await instance.database.learnerReviewEvent.count({ where: { courseId } })).toBe(1);
  });

  it('saves the first draft and resumes without exposing private answer keys', async () => {
    const session = await start();
    const itemId = session.cards[0]!.id;
    expect(
      await saveLearningProgress('PRACTICE', session.sessionId, userId, {
        expectedRevision: 0,
        writingDrafts: { [itemId]: 'my remembered meaning' },
      })
    ).toBe(1);
    const saved = await resumePractice(session.sessionId, userId);
    expect(saved).toMatchObject({
      status: 'ready_vocabulary',
      progressRevision: 1,
      writingDrafts: { [itemId]: 'my remembered meaning' },
    });
    expect(JSON.stringify(saved)).not.toContain('train station');
    await expect(submitPractice(session.sessionId, userId, [])).rejects.toThrow('saved study');
    await answer(session.sessionId, itemId, 'station', 1);
    await expect(
      saveLearningProgress('PRACTICE', session.sessionId, userId, {
        expectedRevision: 2,
        writingDrafts: { [itemId]: 'new meaning' },
      })
    ).rejects.toThrow('different study material');
  });

  it('distinguishes imported, studied, and assessed vocabulary in the dictionary', async () => {
    const imported = await readDictionary(courseId, userId, {});
    expect(imported.counts).toEqual({ unseen: 2, due: 0, strong: 0 });
    expect(imported.words.every((word) => word.state === 'unseen' && word.dueAt === null)).toBe(
      true
    );
    const study = await start('FLASHCARDS');
    await actOnVocabularyStudy(study.sessionId, execution(), {
      action: 'REVEAL',
      itemId: study.cards[0]!.id,
      expectedRevision: 0,
    });
    const seen = await readDictionary(courseId, userId, { search: 'Bahnhof' });
    expect(seen.words[0]).toMatchObject({ state: 'introduced', reviews: 0, dueAt: null });
    const recall = await start();
    await answer(recall.sessionId, recall.cards[0]!.id, 'station');
    const assessed = await readDictionary(courseId, userId, { search: 'Bahnhof' });
    expect(assessed.words[0]).toMatchObject({ state: 'learning', reviews: 1 });
    expect(assessed.words[0]!.dueAt).not.toBeNull();
    const missed = await start();
    await answer(missed.sessionId, missed.cards[0]!.id, 'forgotten');
    const afterMiss = await readDictionary(courseId, userId, { search: 'Bahnhof' });
    expect(afterMiss.words[0]).toMatchObject({ reviews: 2, lastReviewed: expect.any(String) });
    expect(
      await instance.database.learnerVocab.findUniqueOrThrow({ where: { id: wordId } })
    ).toMatchObject({ reps: 0 });
    await expect(readDictionary(courseId, 'another-learner', {})).rejects.toThrow(
      'Course not found'
    );
  });

  it('records flashcard exposure without mastery and requires a separate assessed attempt', async () => {
    const session = await start('FLASHCARDS');
    const revealed = await actOnVocabularyStudy(session.sessionId, execution(), {
      action: 'REVEAL',
      itemId: session.cards[0]!.id,
      expectedRevision: 0,
    });
    expect(revealed.cards[0]!.feedback).toMatchObject({ outcome: 'STUDIED', correct: null });
    const word = await instance.database.learnerVocab.findUniqueOrThrow({ where: { id: wordId } });
    expect(word).toMatchObject({ mastery: 0, reps: 0, lastReviewed: null });
    expect(word.introducedAt).not.toBeNull();
    expect(await instance.database.learnerReviewEvent.count({ where: { courseId } })).toBe(0);
    await expect(answer(session.sessionId, session.cards[0]!.id, 'station', 1)).rejects.toThrow(
      'already has feedback'
    );
    const receipt = await actOnVocabularyStudy(session.sessionId, execution(), {
      action: 'COMPLETE',
      expectedRevision: revealed.progressRevision,
    });
    expect(receipt.receipt).toMatchObject({ score: null, reviewed: 0, studied: 1 });
    const recall = await start();
    expect(
      (await answer(recall.sessionId, recall.cards[0]!.id, 'station')).cards[0]!.feedback?.correct
    ).toBe(true);
  });

  it.each(['KNOWN', 'UNKNOWN'] as const)(
    'records a %s self-rating once, preserves it on resume, and updates the review schedule',
    async (rating) => {
      const study = await start('FLASHCARDS');
      const action = { action: 'RATE', itemId: study.cards[0]!.id, rating, expectedRevision: 0 };
      const rated = await actOnVocabularyStudy(study.sessionId, execution(), action);
      expect(rated.cards[0]!.feedback).toMatchObject({ outcome: 'STUDIED', selfRating: rating });
      const retried = await actOnVocabularyStudy(study.sessionId, execution(), action);
      expect(retried.cards[0]!.feedback?.selfRating).toBe(rating);
      await expect(
        actOnVocabularyStudy(study.sessionId, execution(), {
          ...action,
          rating: rating === 'KNOWN' ? 'UNKNOWN' : 'KNOWN',
        })
      ).rejects.toThrow('already has feedback');
      const resumed = await resumePractice(study.sessionId, userId);
      expect(resumed).toMatchObject({
        ratingSummary: {
          known: Number(rating === 'KNOWN'),
          unknown: Number(rating === 'UNKNOWN'),
          studied: 0,
        },
        cards: [{ feedback: { selfRating: rating } }],
      });
      const events = await instance.database.learnerReviewEvent.findMany({ where: { courseId } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        assessment: 'FLASHCARD_SELF_ASSESSMENT',
        quality: rating === 'KNOWN' ? 1 : 0,
      });
      expect(
        (await instance.database.learnerVocab.findUniqueOrThrow({ where: { id: wordId } }))
          .lastReviewed
      ).not.toBeNull();
    }
  );

  it('enforces the migrated flashcard and refill constraints in PostgreSQL', async () => {
    const study = await start('FLASHCARDS');
    await actOnVocabularyStudy(study.sessionId, execution(), {
      action: 'RATE',
      itemId: study.cards[0]!.id,
      rating: 'KNOWN',
      expectedRevision: 0,
    });
    await expect(
      instance.database.flashcardRating.update({
        where: {
          practiceSessionId_cardId: {
            practiceSessionId: study.sessionId,
            cardId: study.cards[0]!.id,
          },
        },
        data: { rating: 'INVALID' },
      })
    ).rejects.toThrow(/FlashcardRating_rating_check/);
    const event = await instance.database.learnerReviewEvent.findFirstOrThrow({
      where: { courseId },
    });
    await expect(
      instance.database.learnerReviewEvent.update({
        where: { sequence: event.sequence },
        data: { assessment: 'INVALID' },
      })
    ).rejects.toThrow(/LearnerReviewEvent_assessment_check/);
    await expect(
      instance.database.flashcardExample.create({
        data: {
          practiceSessionId: study.sessionId,
          courseId,
          cardId: study.cards[0]!.id,
          sourceHash: 'hash',
          operationId: randomUUID(),
          status: 'INVALID',
        },
      })
    ).rejects.toThrow(/FlashcardExample_status_check/);
    await expect(
      instance.database.vocabularyRefill.create({
        data: {
          courseId,
          generation: 1,
          operationId: randomUUID(),
          sourceHash: 'hash',
          status: 'INVALID',
        },
      })
    ).rejects.toThrow(/VocabularyRefill_status_check/);
    expect(
      (await instance.database.flashcardRating.findFirstOrThrow({ where: { courseId } })).rating
    ).toBe('KNOWN');
  });

  it('retains the self-rating when its dictionary word is deleted', async () => {
    const study = await start('FLASHCARDS');
    await actOnVocabularyStudy(study.sessionId, execution(), {
      action: 'RATE',
      itemId: study.cards[0]!.id,
      rating: 'UNKNOWN',
      expectedRevision: 0,
    });
    await instance.database.learnerVocab.delete({ where: { id: wordId } });
    expect(await resumePractice(study.sessionId, userId)).toMatchObject({
      ratingSummary: { known: 0, unknown: 1, studied: 0 },
      cards: [{ feedback: { selfRating: 'UNKNOWN' } }],
    });
  });

  it('does not retroactively rate a legacy flashcard reveal', async () => {
    const study = await start('FLASHCARDS');
    await actOnVocabularyStudy(study.sessionId, execution(), {
      action: 'REVEAL',
      itemId: study.cards[0]!.id,
      expectedRevision: 0,
    });
    await expect(
      actOnVocabularyStudy(study.sessionId, execution(), {
        action: 'RATE',
        itemId: study.cards[0]!.id,
        rating: 'UNKNOWN',
        expectedRevision: 0,
      })
    ).rejects.toThrow('already has feedback');
    expect(await instance.database.learnerReviewEvent.count({ where: { courseId } })).toBe(0);
    expect(
      await instance.database.flashcardRating.count({
        where: { practiceSessionId: study.sessionId },
      })
    ).toBe(0);
  });

  it('accepts only one of two conflicting concurrent self-ratings', async () => {
    const study = await start('FLASHCARDS');
    const result = await Promise.allSettled(
      ['KNOWN', 'UNKNOWN'].map((rating) =>
        actOnVocabularyStudy(study.sessionId, execution(), {
          action: 'RATE',
          itemId: study.cards[0]!.id,
          rating,
          expectedRevision: 0,
        })
      )
    );
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect(
      await instance.database.flashcardRating.count({
        where: { practiceSessionId: study.sessionId },
      })
    ).toBe(1);
    expect(await instance.database.learnerReviewEvent.count({ where: { courseId } })).toBe(1);
  });

  it('treats answer reveal as a miss and prevents correcting it for additional credit', async () => {
    const session = await start();
    const revealed = await actOnVocabularyStudy(session.sessionId, execution(), {
      action: 'REVEAL',
      itemId: session.cards[0]!.id,
      expectedRevision: 0,
    });
    expect(revealed.cards[0]!.feedback).toMatchObject({ outcome: 'REVEALED', correct: false });
    await expect(answer(session.sessionId, session.cards[0]!.id, 'station', 1)).rejects.toThrow(
      'already has feedback'
    );
    const events = await instance.database.learnerReviewEvent.findMany({ where: { courseId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ assessment: 'MEANING_RECALL', quality: 0 });
  });

  it('replays admission with its original preference and rejects reused or discarded identities', async () => {
    const requestId = randomUUID();
    const original = await startVocabularyStudy(courseId, execution(), { requestId });
    await instance.database.course.update({
      where: { id: courseId },
      data: { vocabularySupport: 'WORD_RECALL' },
    });
    expect(await startVocabularyStudy(courseId, execution(), { requestId })).toEqual(original);
    await expect(
      startVocabularyStudy(courseId, execution(), { requestId, mode: 'WORD_RECALL' })
    ).rejects.toThrow('different study');
    await instance.database.practiceSession.delete({ where: { id: requestId } });
    await expect(startVocabularyStudy(courseId, execution(), { requestId })).rejects.toThrow(
      'discarded'
    );
  });

  it('rejects another learner and words outside the owned dictionary', async () => {
    await expect(
      startVocabularyStudy(courseId, authorizedLearnerExecution('another-learner'), {
        requestId: randomUUID(),
      })
    ).rejects.toThrow('Course not found');
    await expect(
      startVocabularyStudy(courseId, execution(), {
        requestId: randomUUID(),
        wordIds: ['not-an-owned-word'],
      })
    ).rejects.toThrow('not available');
    const session = await start();
    await expect(
      actOnVocabularyStudy(session.sessionId, authorizedLearnerExecution('another-learner'), {
        action: 'REVEAL',
        itemId: session.cards[0]!.id,
        expectedRevision: 0,
      })
    ).rejects.toThrow('not found');
  });
});
