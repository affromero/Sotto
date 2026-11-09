import { expect, it } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';
import {
  classTaskMaterialHash,
  readClassTeachingPrelude,
  requireInitialA1PracticeAccess,
} from '@/lib/classes/lesson/initial-a1-provenance';
import { authorizedLearnerExecution } from '../../../../helpers/runtime/provider-execution';
import type { SharedTestInstance } from '../../../../helpers/setup/shared-instance';

export function registerPreludeCases(getInstance: () => SharedTestInstance) {
  it('distinguishes unavailable, generated, replayed and later lessons without exposing tasks', async () => {
    const instance = getInstance();
    const { ownerId } = await instance.reset();
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'ru' } },
      create: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
      update: {},
    });
    const lesson = await instance.database.lesson.create({
      data: {
        curriculumId: curriculum.id,
        slug: `prelude-${ownerId}`,
        level: 'A1',
        order:
          (await instance.database.lesson.count({ where: { curriculumId: curriculum.id } })) + 1,
        title: 'First lesson',
        objective: 'Greet',
        grammarPoints: [],
        targetVocab: [],
        vocabThemes: [],
      },
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
    const execution = authorizedLearnerExecution(ownerId);
    const read = () => readClassTeachingPrelude(instance.database, cls.id, execution);
    const requirePractice = () =>
      instance.database.$transaction((database) =>
        requireInitialA1PracticeAccess(database, cls.id, ownerId)
      );
    await expect(read()).resolves.toEqual({ kind: 'GENERATING' });
    const material = await classTaskMaterialHash(instance.database, cls.id, ownerId);
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: {
        learnerAnswers: { saved: 1 },
        writingDrafts: { saved: 'draft' },
        progressRevision: 1,
      },
    });
    expect(await classTaskMaterialHash(instance.database, cls.id, ownerId)).toBe(material);
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { passThreshold: 0.8 },
    });
    expect(await classTaskMaterialHash(instance.database, cls.id, ownerId)).not.toBe(material);
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { passThreshold: 0.7 },
    });
    expect(await classTaskMaterialHash(instance.database, cls.id, ownerId)).toBe(material);
    await expect(requirePractice()).rejects.toThrow('Review the prerequisite teaching');
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { status: 'AVAILABLE' },
    });
    await expect(read()).resolves.toEqual({ kind: 'UNAVAILABLE' });
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { sourceTitle: 'Unknown sourced level' },
    });
    await expect(read()).resolves.toEqual({ kind: 'UNAVAILABLE' });
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { sourceTitle: null, skillRequirements: { version: 1 } },
    });
    await expect(read()).resolves.toEqual({ kind: 'UNAVAILABLE' });
    const requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'es',
      targetLang: 'ru',
      level: 'A2',
      ttsProvider: null,
      sttProvider: null,
    });
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { skillRequirements: requirements },
    });
    await expect(read()).resolves.toEqual({ kind: 'NOT_REQUIRED' });
    await expect(requirePractice()).resolves.toBeUndefined();
    const a1 = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'es',
      targetLang: 'ru',
      level: 'A1',
      ttsProvider: null,
      sttProvider: null,
    });
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { skillRequirements: a1 },
    });
    const prior = await instance.database.courseClass.create({
      data: {
        courseId: course.id,
        lessonId: lesson.id,
        order: 2,
        status: 'PASSED',
        createdAt: new Date(0),
      },
    });
    await expect(read()).resolves.toEqual({ kind: 'NOT_REQUIRED' });
    await instance.database.courseClass.update({
      where: { id: prior.id },
      data: { sourceTitle: 'Unknown sourced level' },
    });
    await expect(read()).resolves.toEqual({ kind: 'UNAVAILABLE' });
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { status: 'PASSED' },
    });
    await expect(read()).resolves.toEqual({ kind: 'REPLAY' });
    await expect(requirePractice()).rejects.toThrow('Review the prerequisite teaching');
  });
}
