// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { getVocabularyTargets } from '@/lib/learning/vocabulary/targets';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('dictionary selection against PostgreSQL', () => {
  let instance: SharedTestInstance;
  let courseId: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('vocabulary_selection');
    boundary.database = instance.database;
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });
  beforeEach(async () => {
    const { ownerId } = await instance.reset();
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Vocabulary fixture' },
      update: {},
    });
    courseId = (
      await instance.database.course.create({
        data: { userId: ownerId, curriculumId: curriculum.id, nativeLang: 'en', targetLang: 'de' },
      })
    ).id;
  });

  it('keeps active dictionary review visible after a large import without recording mastery', async () => {
    await instance.database.learnerVocab.createMany({
      data: Array.from({ length: 200 }, (_, index) => ({
        courseId,
        lemma: `imported${index}`,
        translation: `new word ${index}`,
      })),
    });
    const active = await instance.database.learnerVocab.create({
      data: {
        courseId,
        lemma: 'Bahnhof',
        translation: 'station',
        mastery: 0.4,
        reps: 2,
        lastReviewed: new Date('2026-10-01'),
        dueAt: new Date('2100-01-01'),
      },
    });
    const selected = await getVocabularyTargets(
      courseId,
      [],
      [{ lemma: 'Zug', gloss: 'train' }],
      8
    );
    expect(selected).toEqual([{ lemma: 'Bahnhof', gloss: 'station' }]);
    expect(
      await instance.database.learnerVocab.findUnique({ where: { id: active.id } })
    ).toMatchObject({
      mastery: 0.4,
      reps: 2,
      lastReviewed: active.lastReviewed,
    });
    expect(
      await instance.database.learnerVocab.count({ where: { courseId, lastReviewed: null } })
    ).toBe(200);
  });

  it('opens the imported queue after actual review mastery becomes solid', async () => {
    const active = await instance.database.learnerVocab.create({
      data: {
        courseId,
        lemma: 'Bahnhof',
        translation: 'station',
        mastery: 0.2,
        reps: 1,
        lastReviewed: new Date(),
        dueAt: new Date('2100-01-01'),
      },
    });
    await instance.database.learnerVocab.create({
      data: { courseId, lemma: 'Fahrkarte', translation: 'ticket' },
    });
    expect(await getVocabularyTargets(courseId, [], [], 8)).toEqual([
      { lemma: 'Bahnhof', gloss: 'station' },
    ]);
    await instance.database.learnerVocab.update({
      where: { id: active.id },
      data: { mastery: 0.9 },
    });
    expect(await getVocabularyTargets(courseId, [], [], 8)).toEqual([
      { lemma: 'Fahrkarte', gloss: 'ticket' },
    ]);
  });

  it('recognizes mastered candidates outside the bounded working set instead of reintroducing them', async () => {
    await instance.database.learnerVocab.createMany({
      data: Array.from({ length: 80 }, (_, index) => ({
        courseId,
        lemma: `known${index}`,
        translation: 'known',
        mastery: 0.9,
        reps: 6,
        lastReviewed: new Date(),
        dueAt: new Date('2100-01-01'),
      })),
    });
    await instance.database.learnerVocab.create({
      data: {
        courseId,
        lemma: 'Bahnhof',
        translation: 'station',
        mastery: 1,
        reps: 10,
        lastReviewed: new Date(),
        dueAt: new Date('2100-01-01'),
      },
    });
    expect(
      await getVocabularyTargets(courseId, [], [{ lemma: 'Bahnhof', gloss: 'station' }], 8)
    ).toEqual([]);
    expect(
      await getVocabularyTargets(
        courseId,
        [{ id: 'due', lemma: 'Bahnhof', translation: 'station', mastery: 1 }],
        [],
        8
      )
    ).toEqual([{ lemma: 'Bahnhof', gloss: 'station' }]);
  });
});
