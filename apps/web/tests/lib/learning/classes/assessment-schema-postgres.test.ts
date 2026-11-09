// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';
import { registerSchemaHistoryCases } from './schema-cases/schema-history';
import { registerSchemaFreezeCases } from './schema-cases/schema-freeze';
import { registerSchemaSourceCases } from './schema-cases/schema-sources';
import { registerSchemaIdentityCases } from './schema-cases/schema-identities';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

describe.skipIf(!process.env.SIDEDOOR_TEST_DATABASE_URL)('held-out assessment storage', () => {
  let instance: SharedTestInstance;
  let ownerId: string;
  let courseId: string;
  let classId: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('assessment_schema');
  }, 120_000);
  afterAll(async () => {
    await instance?.close();
  });
  beforeEach(async () => {
    ownerId = (await instance.reset()).ownerId;
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'ru' } },
      create: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
      update: {},
    });
    const lesson = await instance.database.lesson.upsert({
      where: { curriculumId_slug: { curriculumId: curriculum.id, slug: 'assessment-test' } },
      create: {
        curriculumId: curriculum.id,
        slug: 'assessment-test',
        level: 'A1',
        order: 1,
        title: 'First lesson',
        objective: 'Greet',
        grammarPoints: [],
        targetVocab: [],
        vocabThemes: [],
      },
      update: {},
    });
    const course = await instance.database.course.create({
      data: { userId: ownerId, curriculumId: curriculum.id, nativeLang: 'es', targetLang: 'ru' },
    });
    courseId = course.id;
    classId = (
      await instance.database.courseClass.create({
        data: { courseId, lessonId: lesson.id, order: 1, status: 'IN_PROGRESS' },
      })
    ).id;
  });

  const assessment = (attempt: number, number: number) => ({
    classId,
    courseId,
    userId: ownerId,
    classAttempt: attempt,
    assessmentAttempt: number,
    requirements: {},
    formativeRevision: 'observed',
    teachingKind: 'BASE',
    teachingReceiptId: 'teaching-receipt',
  });

  registerSchemaIdentityCases(() => ({ instance, ownerId, courseId, classId, assessment }));

  registerSchemaSourceCases(() => ({ instance, ownerId, courseId, classId, assessment }));

  registerSchemaFreezeCases(() => ({ instance, ownerId, courseId, classId, assessment }));

  registerSchemaHistoryCases(() => ({ instance, ownerId, courseId, classId, assessment }));
});
