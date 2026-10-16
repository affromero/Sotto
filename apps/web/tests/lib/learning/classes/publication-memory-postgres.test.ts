// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSkillRequirements, learningSkills } from '@sotto/shared';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { publishClassGeneration } from '@/lib/learning/classes/class-generation-state';
import { assertStoredClassMaterial } from '@/lib/learning/classes/class-material';
import { learningScriptHash } from '@/lib/learning/script-hash';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('class publication memory against PostgreSQL', () => {
  let instance: SharedTestInstance;
  let userId: string;
  let courseId: string;
  let classId: string;
  let lessonId: string;
  let episodeId: string;
  const targets = {
    vocab: [
      { lemma: 'reisen', gloss: 'travel', pos: 'verb' },
      { lemma: 'bekannt', gloss: 'familiar', pos: 'adjective' },
    ],
    grammarPoints: ['present-perfect'],
  };
  const passageText = 'Mia kauft ein Ticket.';
  const turns = [{ speaker: 'HOST', text: 'Mia plant eine Reise.' }];

  beforeAll(async () => {
    instance = await createSharedTestInstance('class_publication_memory');
    binding.database = instance.database;
  });
  afterAll(async () => {
    await instance?.close();
    binding.database = null;
  });
  beforeEach(async () => {
    userId = (await instance.reset()).ownerId;
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'German' },
      update: {},
    });
    const lesson = await instance.database.lesson.upsert({
      where: { curriculumId_slug: { curriculumId: curriculum.id, slug: 'travel-memory' } },
      create: {
        curriculumId: curriculum.id,
        slug: 'travel-memory',
        level: 'A2',
        order: 1,
        title: 'Travel',
        objective: 'Describe a journey',
        grammarPoints: ['unselected-curriculum-grammar'],
        targetVocab: [{ lemma: 'unselected-curriculum-word', gloss: 'unselected' }],
        vocabThemes: ['travel'],
      },
      update: {},
    });
    lessonId = lesson.id;
    courseId = (
      await instance.database.course.create({
        data: {
          userId,
          curriculumId: curriculum.id,
          nativeLang: 'en',
          targetLang: 'de',
          currentLevel: 'A2',
        },
      })
    ).id;
    const requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'en',
      targetLang: 'de',
      level: 'A2',
      ttsProvider: 'cartesia',
      sttProvider: null,
    });
    classId = (
      await instance.database.courseClass.create({
        data: {
          courseId,
          lessonId,
          order: 1,
          attempt: 2,
          status: 'GENERATING',
          skillRequirements: requirements,
          adaptiveSeed: { classTargets: targets },
        },
      })
    ).id;
    episodeId = (
      await instance.database.episode.create({
        data: { userId, title: 'A journey', topic: 'Travel', status: 'SCRIPT_READY' },
      })
    ).id;
    await instance.database.script.create({
      data: { episodeId, turns, markdown: 'HOST: Mia plant eine Reise.' },
    });
    await instance.database.vocabularyEntry.create({
      data: {
        episodeId,
        number: 1,
        word: 'Reise',
        translation: 'journey',
        partOfSpeech: 'noun',
        pronunciation: 'RAI-zuh',
      },
    });
    const questionIds: string[] = [];
    for (const skill of learningSkills) {
      const requirement = requirements.skills[skill];
      if (requirement.state !== 'REQUIRED') continue;
      const section = await instance.database.classSection.create({
        data: {
          classId,
          attempt: 2,
          skill,
          status: 'READY',
          seed: skill,
          spec: skill === 'LISTENING' ? { scriptHash: learningScriptHash(turns) } : {},
          episodeId: skill === 'LISTENING' ? episodeId : null,
        },
      });
      for (let index = 0; index < requirement.expectedCount; index++) {
        if (skill === 'WRITING') {
          await instance.database.writingPrompt.create({
            data: {
              sectionId: section.id,
              order: index + 1,
              task: 'Translate: Mia bought a ticket.',
            },
          });
          continue;
        }
        const question = await instance.database.lessonQuestion.create({
          data: {
            sectionId: section.id,
            skill,
            order: index + 1,
            question: 'What does Mia buy?',
            options: ['ein Ticket', 'ein Buch', 'einen Tisch', 'einen Hut'],
            correctIndex: 0,
            explanation: 'Mia kauft ein Ticket.',
            passageText: skill === 'READING' ? passageText : null,
          },
        });
        if (skill === 'READING') questionIds.push(question.id);
      }
    }
    await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        readingVocabulary: {
          passageText,
          sourceHash: createHash('sha256').update(passageText).digest('hex'),
          words: [
            { lemma: 'Ticket', gloss: 'ticket', pos: 'noun', sourceForm: 'Ticket', questionIds },
          ],
        },
      },
    });
  });

  function publish(database: Prisma.TransactionClient, adaptiveSeed?: Prisma.InputJsonValue) {
    return publishClassGeneration(database, {
      classId,
      attempt: 2,
      userId,
      data: adaptiveSeed === undefined ? {} : { adaptiveSeed },
    });
  }

  async function expectUnpublishedMemory() {
    expect(await instance.database.learnerVocab.count({ where: { courseId } })).toBe(0);
    expect(await instance.database.learnerGrammar.count({ where: { courseId } })).toBe(0);
    expect(
      (await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } })).status
    ).toBe('GENERATING');
  }

  it('publishes new selected, reading and listening words without claiming mastery', async () => {
    await expect(assertStoredClassMaterial(instance.database, classId)).rejects.toThrow(
      'missing from this course memory'
    );
    await instance.database.$transaction((database) => publish(database));
    const words = await instance.database.learnerVocab.findMany({
      where: { courseId },
      orderBy: { lemma: 'asc' },
    });
    expect(words.map((word) => word.lemma).sort()).toEqual([
      'Reise',
      'Ticket',
      'bekannt',
      'reisen',
    ]);
    for (const word of words)
      expect(word).toMatchObject({
        firstSeenClassId: classId,
        cefrLevel: 'A2',
        mastery: 0,
        reps: 0,
      });
    expect(words.find((word) => word.lemma === 'Reise')).toMatchObject({
      translation: 'journey',
      pronunciation: 'RAI-zuh',
    });
    expect(await instance.database.learnerGrammar.findMany({ where: { courseId } })).toEqual([
      expect.objectContaining({
        topicKey: 'present-perfect',
        mastery: 0,
        reps: 0,
        cefrLevel: 'A2',
      }),
    ]);
    expect(
      (await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })).activeClassId
    ).toBe(classId);
    expect(
      (await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } })).status
    ).toBe('AVAILABLE');
  });

  it('keeps existing word meanings and all vocabulary and grammar review state exact', async () => {
    const existing = await instance.database.learnerVocab.create({
      data: {
        courseId,
        lemma: 'bekannt',
        translation: 'known from the learner notes',
        firstSeenClassId: 'original-class',
        cefrLevel: 'B1',
        mastery: 0.93,
        reps: 9,
        lapses: 2,
        ease: 2.2,
        intervalDays: 18,
        dueAt: new Date('2030-01-01T00:00:00Z'),
        lastReviewed: new Date('2026-10-01T00:00:00Z'),
      },
    });
    const grammar = await instance.database.learnerGrammar.create({
      data: {
        courseId,
        topicKey: 'present-perfect',
        title: 'Known grammar',
        mastery: 0.8,
        reps: 7,
        dueAt: new Date('2030-01-01T00:00:00Z'),
      },
    });
    await instance.database.$transaction((database) => publish(database));
    expect(await instance.database.learnerVocab.findUnique({ where: { id: existing.id } })).toEqual(
      existing
    );
    expect(
      await instance.database.learnerGrammar.findUnique({ where: { id: grammar.id } })
    ).toEqual(grammar);
  });

  it('uses the newly accepted target seed and ignores vocabulary from an older listening attempt', async () => {
    const oldEpisode = await instance.database.episode.create({
      data: { userId, title: 'Old script', topic: 'Old topic', status: 'FAILED' },
    });
    await instance.database.vocabularyEntry.create({
      data: { episodeId: oldEpisode.id, number: 1, word: 'verworfen', translation: 'discarded' },
    });
    await instance.database.classSection.create({
      data: {
        classId,
        skill: 'LISTENING',
        attempt: 1,
        status: 'FAILED',
        seed: 'old',
        spec: {},
        episodeId: oldEpisode.id,
      },
    });
    await instance.database.$transaction((database) =>
      publish(database, {
        classTargets: { vocab: [{ lemma: 'neu', gloss: 'new' }], grammarPoints: [] },
      })
    );
    const words = await instance.database.learnerVocab.findMany({ where: { courseId } });
    expect(words.map((word) => word.lemma).sort()).toEqual(['Reise', 'Ticket', 'neu']);
    expect(await instance.database.learnerGrammar.count({ where: { courseId } })).toBe(0);
  });

  it('supports historical target-less seeds without inventing new curriculum memory', async () => {
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { adaptiveSeed: {} },
    });
    await instance.database.$transaction((database) => publish(database));
    const words = await instance.database.learnerVocab.findMany({ where: { courseId } });
    expect(words.map((word) => word.lemma).sort()).toEqual(['Reise', 'Ticket']);
    expect(await instance.database.learnerGrammar.count({ where: { courseId } })).toBe(0);
  });

  it.each([
    'reading-source',
    'incomplete-writing',
    'changed-script',
    'foreign-episode',
    'deleted-episode',
  ] as const)(
    'rolls back all new memory and the active gate when %s fails material validation',
    async (damage) => {
      if (damage === 'reading-source')
        await instance.database.lessonQuestion.updateMany({
          where: { section: { classId, skill: 'READING' } },
          data: { passageText: 'Unrelated source.' },
        });
      if (damage === 'incomplete-writing')
        await instance.database.writingPrompt.deleteMany({ where: { section: { classId } } });
      if (damage === 'changed-script')
        await instance.database.script.update({
          where: { episodeId },
          data: { turns: [{ speaker: 'HOST', text: 'An unrelated script.' }] },
        });
      if (damage === 'foreign-episode') {
        const foreign = await instance.database.user.create({
          data: { name: 'Other learner', email: 'foreign-publication@test.local' },
        });
        await instance.database.episode.update({
          where: { id: episodeId },
          data: { userId: foreign.id },
        });
      }
      if (damage === 'deleted-episode')
        await instance.database.episode.update({
          where: { id: episodeId },
          data: { deletedAt: new Date() },
        });
      await expect(
        instance.database.$transaction((database) => publish(database))
      ).rejects.toThrow();
      await expectUnpublishedMemory();
      expect(
        (await instance.database.course.findUniqueOrThrow({ where: { id: courseId } }))
          .activeClassId
      ).toBeNull();
    }
  );

  it('keeps the other active class and memory unchanged on a course gate conflict', async () => {
    const active = await instance.database.courseClass.create({
      data: { courseId, lessonId, order: 2, status: 'AVAILABLE' },
    });
    await instance.database.course.update({
      where: { id: courseId },
      data: { activeClassId: active.id },
    });
    await expect(instance.database.$transaction((database) => publish(database))).rejects.toThrow(
      'active course class changed'
    );
    await expectUnpublishedMemory();
    expect(
      (await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })).activeClassId
    ).toBe(active.id);
  });

  it('rejects stale attempts and foreign owners before creating memory', async () => {
    for (const changed of [
      { attempt: 1, userId },
      { attempt: 2, userId: 'foreign-owner' },
    ])
      await expect(
        instance.database.$transaction((database) =>
          publishClassGeneration(database, {
            classId,
            ...changed,
            data: {},
          })
        )
      ).rejects.toThrow('cancelled');
    await expectUnpublishedMemory();
  });

  it('rolls back memory when the surrounding publication receipt transaction fails', async () => {
    await expect(
      instance.database.$transaction(async (database) => {
        await publish(database);
        throw new Error('Publication receipt cancelled');
      })
    ).rejects.toThrow('Publication receipt cancelled');
    await expectUnpublishedMemory();
    expect(
      (await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })).activeClassId
    ).toBeNull();
  });
});
