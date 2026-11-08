// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { requireStoredInitialA1Sections } from '@/lib/classes/quality/section-review/stored-section-review';
import type { InitialA1SectionSnapshot } from '@/lib/classes/quality/section-review/section-review-proof';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('stored first-A1 section review', () => {
  let instance: SharedTestInstance;
  let classId: string;
  let sectionId: string;
  let questionId: string;
  let expected: InitialA1SectionSnapshot[];

  beforeAll(async () => {
    instance = await createSharedTestInstance('section_review');
  });
  afterAll(async () => {
    await instance?.close();
  });
  beforeEach(async () => {
    const { ownerId } = await instance.reset();
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'ru' } },
      create: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
      update: {},
    });
    const lesson = await instance.database.lesson.upsert({
      where: { curriculumId_slug: { curriculumId: curriculum.id, slug: 'section-review' } },
      create: {
        curriculumId: curriculum.id,
        slug: 'section-review',
        level: 'A1',
        order: 1,
        title: 'First lesson',
        objective: 'Ask a question',
        grammarPoints: [],
        targetVocab: [],
        vocabThemes: [],
      },
      update: {},
    });
    const course = await instance.database.course.create({
      data: {
        userId: ownerId,
        curriculumId: curriculum.id,
        nativeLang: 'es',
        targetLang: 'ru',
      },
    });
    const cls = await instance.database.courseClass.create({
      data: {
        courseId: course.id,
        lessonId: lesson.id,
        order: 1,
        status: 'GENERATING',
      },
    });
    classId = cls.id;
    const section = await instance.database.classSection.create({
      data: {
        classId,
        skill: 'GRAMMAR',
        attempt: 1,
        status: 'READY',
        seed: 'reviewed-seed',
        spec: {},
      },
    });
    sectionId = section.id;
    const question = await instance.database.lessonQuestion.create({
      data: {
        sectionId,
        skill: 'GRAMMAR',
        order: 1,
        question: 'Elige una pregunta.',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: 'A is correct.',
      },
    });
    questionId = question.id;
    expected = [
      {
        classId,
        courseId: course.id,
        userId: ownerId,
        sectionId,
        skill: 'GRAMMAR',
        attempt: 1,
        seed: 'reviewed-seed',
        questions: [
          {
            id: questionId,
            order: 1,
            question: question.question,
            options: ['A', 'B', 'C', 'D'],
            correctIndex: 0,
            explanation: question.explanation,
            passageRef: null,
            passageText: null,
          },
        ],
      },
    ];
  });

  it('accepts the exact reviewed rows without depending on learner progress', async () => {
    await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        learnerAnswers: { [questionId]: 1 },
        writingDrafts: { draft: 'saved' },
        progressRevision: 3,
      },
    });
    await expect(
      instance.database.$transaction((database) =>
        requireStoredInitialA1Sections(database, classId, expected)
      )
    ).resolves.toBeUndefined();
  });

  it.each([
    'question',
    'options',
    'key',
    'explanation',
    'passage',
    'extra question',
    'replacement section',
  ] as const)('rejects a changed %s', async (change) => {
    if (change === 'question')
      await instance.database.lessonQuestion.update({
        where: { id: questionId },
        data: { question: 'Changed' },
      });
    if (change === 'options')
      await instance.database.lessonQuestion.update({
        where: { id: questionId },
        data: { options: ['B', 'A', 'C', 'D'] },
      });
    if (change === 'key')
      await instance.database.lessonQuestion.update({
        where: { id: questionId },
        data: { correctIndex: 1 },
      });
    if (change === 'explanation')
      await instance.database.lessonQuestion.update({
        where: { id: questionId },
        data: { explanation: 'Changed' },
      });
    if (change === 'passage')
      await instance.database.lessonQuestion.update({
        where: { id: questionId },
        data: { passageText: 'Changed' },
      });
    if (change === 'extra question')
      await instance.database.lessonQuestion.create({
        data: {
          sectionId,
          skill: 'GRAMMAR',
          order: 2,
          question: 'Another question',
          options: ['A', 'B', 'C', 'D'],
          correctIndex: 0,
          explanation: 'A.',
        },
      });
    if (change === 'replacement section')
      await instance.database.classSection.create({
        data: {
          classId,
          skill: 'GRAMMAR',
          attempt: 2,
          status: 'READY',
          seed: 'new-seed',
          spec: {},
        },
      });
    await expect(
      instance.database.$transaction((database) =>
        requireStoredInitialA1Sections(database, classId, expected)
      )
    ).rejects.toThrow('reviewed exercises changed');
  });
});
