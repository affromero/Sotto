import { it, expect } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';
import { requestClassPreparation } from '@/lib/classes/preparation';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { SharedTestInstance } from '../../../helpers/setup/shared-instance';

export function registerInitialA1Tests(
  context: () => {
    instance: SharedTestInstance;
    courseId: string;
    ownerId: string;
    execution: SottoProviderExecution;
    lesson: () => Promise<{ id: string; order: number }>;
  }
) {
  it('keeps the first A1 policy on replay after course history changes', async () => {
    const { instance, courseId, execution, lesson } = context();
    const operation = await requestClassPreparation(courseId, execution);
    expect(operation.initialA1Class).toBe(true);
    const priorLesson = await lesson();
    await instance.database.courseClass.create({
      data: {
        courseId,
        lessonId: priorLesson.id,
        order: priorLesson.order,
        status: 'PASSED',
        skillRequirements: createSkillRequirements({
          scope: 'CLASS',
          nativeLang: 'en',
          targetLang: 'de',
          level: 'A1',
          ttsProvider: 'disabled',
          sttProvider: 'disabled',
        }),
      },
    });
    const replay = await requestClassPreparation(courseId, execution);
    expect(replay.id).toBe(operation.id);
    expect(replay.initialA1Class).toBe(true);
  });

  it('distinguishes a later A1 class from a first class in another course', async () => {
    const { instance, courseId, execution, lesson, ownerId } = context();
    const priorLesson = await lesson();
    await instance.database.courseClass.create({
      data: {
        courseId,
        lessonId: priorLesson.id,
        order: priorLesson.order,
        status: 'PASSED',
        skillRequirements: createSkillRequirements({
          scope: 'CLASS',
          nativeLang: 'en',
          targetLang: 'de',
          level: 'A1',
          ttsProvider: 'disabled',
          sttProvider: 'disabled',
        }),
      },
    });
    const later = await requestClassPreparation(courseId, execution);
    expect(later.initialA1Class).toBe(false);
    const otherCurriculum = await instance.database.curriculum.create({
      data: { nativeLang: 'en', targetLang: 'ru', title: 'Russian fixture' },
    });
    const otherCourse = await instance.database.course.create({
      data: {
        userId: ownerId,
        nativeLang: 'en',
        targetLang: 'ru',
        curriculumId: otherCurriculum.id,
      },
    });
    const first = await requestClassPreparation(otherCourse.id, execution);
    expect(first.initialA1Class).toBe(true);
  });

  it.each(['A2', null] as const)(
    'treats a previous class with %s requirements as insufficient to identify an earlier A1 class',
    async (level) => {
      const { instance, courseId, execution, lesson } = context();
      const priorLesson = await lesson();
      await instance.database.courseClass.create({
        data: {
          courseId,
          lessonId: priorLesson.id,
          order: priorLesson.order,
          status: 'PASSED',
          ...(level
            ? {
                skillRequirements: createSkillRequirements({
                  scope: 'CLASS',
                  nativeLang: 'en',
                  targetLang: 'de',
                  level,
                  ttsProvider: 'disabled',
                  sttProvider: 'disabled',
                }),
              }
            : {}),
        },
      });
      const operation = await requestClassPreparation(courseId, execution);
      expect(operation.initialA1Class).toBe(true);
    }
  );

  it.each([false, true])(
    'classifies a regeneration by earlier A1 class creation, including equal lesson order (%s)',
    async (earlierClass) => {
      const { instance, courseId, execution, lesson } = context();
      const targetLesson = await lesson();
      const requirements = createSkillRequirements({
        scope: 'CLASS',
        nativeLang: 'en',
        targetLang: 'de',
        level: 'A1',
        ttsProvider: 'disabled',
        sttProvider: 'disabled',
      });
      if (earlierClass)
        await instance.database.courseClass.create({
          data: {
            courseId,
            lessonId: targetLesson.id,
            order: 1,
            status: 'PASSED',
            createdAt: new Date('2020-01-01T00:00:00Z'),
            skillRequirements: requirements,
          },
        });
      const target = await instance.database.courseClass.create({
        data: {
          courseId,
          lessonId: targetLesson.id,
          order: 1,
          status: 'FAILED',
          skillRequirements: requirements,
        },
      });
      const operation = await requestClassPreparation(courseId, execution, {
        intent: { kind: 'REGENERATE', classId: target.id, expectedAttempt: 1 },
      });
      expect(operation.initialA1Class).toBe(!earlierClass);
    }
  );
}
