import { randomUUID } from 'node:crypto';
import { createSkillRequirements } from '@sotto/shared';
import type {
  SharedTestInstance,
  SharedTestIdentity,
} from '../../../../helpers/setup/shared-instance';

export async function createRepairTarget(
  instance: SharedTestInstance,
  identity: SharedTestIdentity,
  courseId: string
) {
  await instance.database.user.update({
    where: { id: identity.ownerId },
    data: { preferredTtsProvider: 'disabled' },
  });
  const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
  const lesson = await instance.database.lesson.create({
    data: {
      curriculumId: course.curriculumId,
      slug: randomUUID(),
      level: 'A1',
      order:
        (await instance.database.lesson.count({ where: { curriculumId: course.curriculumId } })) +
        1,
      title: 'Greetings',
      objective: 'Greet someone',
      grammarPoints: [],
      targetVocab: [],
      vocabThemes: [],
    },
  });
  const requirements = createSkillRequirements({
    scope: 'CLASS',
    nativeLang: 'en',
    targetLang: 'de',
    level: 'A1',
    ttsProvider: null,
    sttProvider: null,
  });
  const cls = await instance.database.courseClass.create({
    data: {
      courseId,
      lessonId: lesson.id,
      order: 1,
      status: 'IN_PROGRESS',
      skillRequirements: requirements,
      learnerAnswers: { 'historical-answer': 1 },
      writingDrafts: { 'historical-draft': 'Keep my words.' },
    },
  });
  await instance.database.course.update({
    where: { id: courseId },
    data: { activeClassId: cls.id },
  });
  const grammar = await instance.database.classSection.create({
    data: {
      classId: cls.id,
      skill: 'GRAMMAR',
      seed: 'original',
      spec: {},
      status: 'READY',
      attempt: 7,
      questions: {
        create: Array.from({ length: 5 }, (_, order) => ({
          order: order + 1,
          skill: 'GRAMMAR' as const,
          question: `Greeting ${order}?`,
          options: ['Hallo', 'Tschüss', 'Morgen', 'Gestern'],
          correctIndex: 0,
          explanation: 'Hallo greets someone.',
        })),
      },
    },
    include: { questions: true },
  });
  const writing = await instance.database.classSection.create({
    data: {
      classId: cls.id,
      skill: 'WRITING',
      seed: 'earlier',
      spec: {},
      status: 'READY',
      attempt: 2,
      writingPrompts: {
        create: {
          order: 1,
          task: 'Write a greeting.',
          responses: {
            create: {
              userId: identity.ownerId,
              attempt: 2,
              text: 'Hallo.',
              overallScore: 0.9,
              corrections: [],
              feedback: 'Clear greeting.',
            },
          },
        },
      },
    },
    include: { writingPrompts: true },
  });
  return { cls, grammar, writing, requirements };
}
