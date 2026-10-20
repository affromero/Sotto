// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { submitClass } from '@/lib/learning/classes/class-submission';
import { submitPractice } from '@/lib/practice/submission';
import type { Prisma } from '@/generated/prisma/client';
import { createSubmissionFixture } from './fixtures';
const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('Atomic objective evidence against PostgreSQL', () => {
  const fixture = createSubmissionFixture(binding, 'objective_submission');
  it('commits item evidence and the class receipt once under concurrent resubmission', async () => {
    const cls = await fixture.seedClass(fixture.requirements('CLASS', false, false));
    const question = await fixture.instance.database.lessonQuestion.findFirstOrThrow({
      where: { section: { classId: cls.id }, skill: 'GRAMMAR' },
    });
    const { assessment, objective } = await fixture.reviewedGrammarTask({
      kind: 'KEYED_MULTIPLE_CHOICE',
      question: question.question,
      options: question.options as string[],
      correctIndex: question.correctIndex,
      passageText: question.passageText,
      audio: null,
    });
    await fixture.instance.database.lessonQuestion.update({
      where: { id: question.id },
      data: { learningAssessment: assessment as Prisma.InputJsonValue },
    });
    const alias = objective.grammarKeys[0];
    if (alias) {
      await fixture.instance.database.lesson.update({
        where: { id: fixture.lessonId },
        data: { grammarPoints: [alias] },
      });
      await fixture.instance.database.learnerGrammar.upsert({
        where: { courseId_topicKey: { courseId: fixture.courseId, topicKey: alias } },
        create: { courseId: fixture.courseId, topicKey: alias, title: alias },
        update: {},
      });
    }
    const receipts = await Promise.all([
      submitClass(cls.id, fixture.userId, cls.answers),
      submitClass(cls.id, fixture.userId, cls.answers),
    ]);
    expect(receipts[0]).toEqual(receipts[1]);
    expect(
      await fixture.instance.database.learningObservation.count({
        where: { courseId: fixture.courseId },
      })
    ).toBe(1);
    expect(
      await fixture.instance.database.learnerObjectiveState.findFirstOrThrow({
        where: { courseId: fixture.courseId },
      })
    ).toMatchObject({ assessedTasks: 1, assessedSessions: 1 });
    if (alias)
      expect(
        (
          await fixture.instance.database.learnerGrammar.findUniqueOrThrow({
            where: { courseId_topicKey: { courseId: fixture.courseId, topicKey: alias } },
          })
        ).reps
      ).toBe(0);
  });
  it('rolls back the receipt, evidence and legacy review together when exact attribution is invalid', async () => {
    const cls = await fixture.seedClass(fixture.requirements('CLASS', false, false));
    const question = await fixture.instance.database.lessonQuestion.findFirstOrThrow({
      where: { section: { classId: cls.id }, skill: 'GRAMMAR' },
    });
    const { assessment } = await fixture.reviewedGrammarTask({
      kind: 'KEYED_MULTIPLE_CHOICE',
      question: question.question,
      options: question.options as string[],
      correctIndex: question.correctIndex,
      passageText: question.passageText,
      audio: null,
    });
    await fixture.instance.database.lessonQuestion.update({
      where: { id: question.id },
      data: {
        learningAssessment: {
          ...assessment,
          scope: { ...assessment.scope, courseId: 'foreign-course' },
        } as Prisma.InputJsonValue,
      },
    });
    await expect(submitClass(cls.id, fixture.userId, cls.answers)).rejects.toThrow(/changed/);
    expect(
      await fixture.instance.database.classSubmission.count({ where: { classId: cls.id } })
    ).toBe(0);
    expect(
      await fixture.instance.database.learningObservation.count({
        where: { courseId: fixture.courseId },
      })
    ).toBe(0);
    expect(
      (await fixture.instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } }))
        .status
    ).toBe('AVAILABLE');
    expect(
      (
        await fixture.instance.database.learnerVocab.findFirstOrThrow({
          where: { courseId: fixture.courseId },
        })
      ).reps
    ).toBe(0);
  });
  it('does not turn the same assessed task in fresh practice sessions into independent mastery evidence', async () => {
    const sessions = await Promise.all([
      fixture.seedPractice(fixture.requirements('FULL', false, false)),
      fixture.seedPractice(fixture.requirements('FULL', false, false)),
    ]);
    for (const session of sessions) {
      const stored = await fixture.instance.database.practiceSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      const items = stored.items as Array<{
        id: string;
        prompt: string;
        options: string[];
        correctIndex: number;
        learningAssessment?: Prisma.InputJsonValue;
      }>;
      const question = items.find((item) => item.id === 'g0')!;
      const { assessment } = await fixture.reviewedGrammarTask({
        kind: 'KEYED_MULTIPLE_CHOICE',
        question: question.prompt,
        options: question.options,
        correctIndex: question.correctIndex,
        passageText: null,
        audio: null,
      });
      question.learningAssessment = assessment as Prisma.InputJsonValue;
      await fixture.instance.database.practiceSession.update({
        where: { id: session.id },
        data: { items },
      });
      await submitPractice(session.id, fixture.userId, session.answers);
    }
    expect(
      await fixture.instance.database.learningObservation.count({
        where: { courseId: fixture.courseId },
      })
    ).toBe(2);
    expect(
      await fixture.instance.database.learnerObjectiveState.findFirstOrThrow({
        where: { courseId: fixture.courseId },
      })
    ).toMatchObject({ assessedTasks: 1, assessedSessions: 1, reps: 2 });
  });
});
