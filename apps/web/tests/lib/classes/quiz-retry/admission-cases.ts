import { randomUUID } from 'node:crypto';
import { createSkillRequirements } from '@sotto/shared';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import {
  classPreparationStore,
  recordClassPreparationFailure,
  requestClassPreparation,
  readPreparationActivity,
} from '@/lib/classes/preparation';
import { PreparationConflictError } from '@/lib/classes/preparation-state';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { classPreparationGrant } from '@/lib/classes/preparation-grant';
import { processClassPreparation } from '@/workers/classes/class-preparation.worker';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { SharedTestInstance } from '../../../helpers/setup/shared-instance';
import { sampleTeaching } from '../../../helpers/learning/class-teaching';

export function registerQuizRetryAdmissionTests(
  context: () => {
    instance: SharedTestInstance;
    courseId: string;
    execution: SottoProviderExecution;
    lesson: () => Promise<{ id: string }>;
    queuedJob: (operationId: string) => Promise<Job<{ operationId: string; fingerprint: string }>>;
  }
) {
  async function fixture(skill: 'GRAMMAR' | 'READING' = 'GRAMMAR') {
    const { instance, courseId, lesson, execution } = context();
    await instance.database.user.update({
      where: { id: execution.userId },
      data: { preferredTtsProvider: 'disabled' },
    });
    const cls = await instance.database.courseClass.create({
      data: {
        courseId,
        lessonId: (await lesson()).id,
        status: 'IN_PROGRESS',
        order: 1,
        attempt: 2,
        progressRevision: 7,
        adaptiveSeed: {
          teaching: sampleTeaching,
          intro: {
            purpose: 'Describe yesterday.',
            about: 'A retained class introduction.',
            focus: ['Use the past tense.'],
            examples: [{ target: 'Ich habe gelesen.', meaning: 'I read.', note: 'Use haben.' }],
            tips: ['Check the auxiliary verb.'],
          },
        },
        readingVocabulary: { passageText: 'Retained reading vocabulary' },
        writingDrafts: { 'retained-writing': 'My unfinished writing' },
        skillRequirements: createSkillRequirements({
          scope: 'CLASS',
          nativeLang: 'en',
          targetLang: 'de',
          level: 'A1',
          ttsProvider: null,
          sttProvider: null,
        }),
      },
    });
    const previous = await instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill,
        attempt: 1,
        seed: randomUUID(),
        spec: {},
        status: 'READY',
        questions: {
          create: {
            order: 1,
            skill,
            question: 'Earlier historical question',
            options: ['A', 'B', 'C', 'D'],
            correctIndex: 0,
            explanation: 'Earlier concept',
          },
        },
      },
      include: { questions: true },
    });
    const target = await instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill,
        attempt: 2,
        seed: randomUUID(),
        spec: {},
        status: 'READY',
        questions: {
          create: Array.from({ length: 5 }, (_, index) => ({
            order: index + 1,
            skill,
            question: `Current question ${index + 1}`,
            options: ['Right', 'Wrong', 'Other', 'Another'],
            correctIndex: 0,
            explanation: `Concept ${index + 1}`,
            passageText: skill === 'READING' ? 'A retained reading passage.' : null,
          })),
        },
      },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    const retained = await instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill: 'WRITING',
        attempt: 1,
        seed: randomUUID(),
        spec: {},
        status: 'PASSED',
        passed: true,
        score: 0.9,
      },
    });
    const answers = Object.fromEntries(
      target.questions.map((question, index) => [question.id, index < 3 ? 0 : 1])
    );
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { learnerAnswers: answers },
    });
    const input = {
      intent: {
        kind: 'REPAIR' as const,
        classId: cls.id,
        expectedAttempt: 2,
        retry: { sectionId: target.id, expectedRevision: 7 },
      },
    };
    vi.stubGlobal('fetch', () => {
      throw new Error('Admission must not dispatch provider requests');
    });
    return { cls, target, previous, retained, answers, input };
  }

  describe('targeted class quiz retry admission', () => {
    it('captures historical questions and missed concepts once while preserving other learner work', async () => {
      const { instance, courseId, execution } = context();
      const { cls, target, retained, answers, input } = await fixture();
      const operation = await requestClassPreparation(courseId, execution, input);
      expect(operation.intent).toMatchObject({
        skills: ['GRAMMAR'],
        retry: { sectionId: target.id, expectedRevision: 7 },
      });
      expect(
        operation.intent?.retry?.context.previousQuestions.map((question) => question.question)
      ).toContain('Earlier historical question');
      expect(operation.intent?.retry?.context.missedQuestions).toEqual([
        { question: 'Current question 4', selectedAnswer: 'Wrong', explanation: 'Concept 4' },
        { question: 'Current question 5', selectedAnswer: 'Wrong', explanation: 'Concept 5' },
      ]);
      expect((await requestClassPreparation(courseId, execution, input)).id).toBe(operation.id);
      expect(
        await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
      ).toMatchObject({
        status: 'GENERATING',
        attempt: 3,
        learnerAnswers: answers,
        writingDrafts: cls.writingDrafts,
      });
      expect(
        await instance.database.classSection.findUnique({ where: { id: retained.id } })
      ).toEqual(retained);
      expect(
        await instance.database.lessonQuestion.count({ where: { sectionId: target.id } })
      ).toBe(5);
      await instance.database.classSection.create({
        data: {
          classId: cls.id,
          skill: 'GRAMMAR',
          attempt: 3,
          seed: randomUUID(),
          spec: {},
          status: 'READY',
        },
      });
      await instance.database.courseClass.update({
        where: { id: cls.id },
        data: { status: 'IN_PROGRESS' },
      });
      await sottoTransaction(instance.database, async (database) => {
        const parent = await sottoJobOutbox(database).read(operation.id);
        if (!parent) throw new Error('Missing preparation receipt');
        await classPreparationGrant(database, operation).complete(operation.grant);
        await classPreparationStore(database, courseId).transact((current) => {
          if (!current) throw new Error('Missing preparation');
          current.status = 'COMPLETED';
          current.result = 'created';
        });
        await sottoJobOutbox(database).complete(operation.id, parent.fingerprint);
      });
      expect((await requestClassPreparation(courseId, execution, input)).id).toBe(operation.id);
    });

    it.each([
      'revision',
      'historical',
      'incomplete',
      'passing',
      'invalid-answer',
      'malformed-history',
    ] as const)(
      'rejects %s work without claiming the class or admitting a provider job',
      async (condition) => {
        const { instance, courseId, execution } = context();
        const { cls, target, previous, answers, input } = await fixture();
        if (condition === 'revision') input.intent.retry.expectedRevision--;
        if (condition === 'historical') input.intent.retry.sectionId = previous.id;
        if (condition === 'incomplete') delete answers[target.questions[0].id];
        if (condition === 'passing')
          Object.keys(answers).forEach((id) => {
            answers[id] = 0;
          });
        if (condition === 'invalid-answer') answers[target.questions[0].id] = 4;
        if (condition === 'malformed-history')
          await instance.database.lessonQuestion.update({
            where: { id: previous.questions[0].id },
            data: { options: { invalid: true } },
          });
        await instance.database.courseClass.update({
          where: { id: cls.id },
          data: { learnerAnswers: answers },
        });
        await expect(requestClassPreparation(courseId, execution, input)).rejects.toBeInstanceOf(
          PreparationConflictError
        );
        expect(
          await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
        ).toMatchObject({
          status: 'IN_PROGRESS',
          attempt: 2,
          progressRevision: 7,
          learnerAnswers: answers,
        });
        expect(
          await sottoTransaction(instance.database, (database) =>
            classPreparationStore(database, courseId).read()
          )
        ).toBeNull();
      }
    );

    it('settles a real worker provider rejection without losing the original questions or learner answers', async () => {
      const { instance, courseId, execution, queuedJob } = context();
      const { cls, target, answers, input } = await fixture();
      await instance.configureInfrastructure({
        aiProvider: 'local',
        aiModel: 'quiz-retry-fixture',
        aiBaseUrl: 'http://localhost:8000/v1',
      });
      await instance.seedAiCredential(execution.userId, 'local', 'quiz-retry-fixture-secret');
      await instance.database.user.update({
        where: { id: execution.userId },
        data: { preferredAiProvider: 'local', preferredAiModel: 'local:quiz-retry-fixture' },
      });
      const operation = await requestClassPreparation(courseId, execution, input);
      const sent: string[] = [];
      vi.stubGlobal('fetch', async (request: RequestInfo | URL, init?: RequestInit) => {
        const incoming = new Request(request, init);
        sent.push(await incoming.text());
        if (new URL(incoming.url).pathname.endsWith('/moderations'))
          return Response.json({
            results: [{ flagged: false, categories: {}, category_scores: {} }],
          });
        return new Response(JSON.stringify({ error: { message: 'Fixture generation rejected' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      });
      await processClassPreparation(await queuedJob(operation.id));
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Concept 4'),
          expect.stringContaining('Earlier historical question'),
        ])
      );
      expect(
        await sottoTransaction(instance.database, (database) =>
          classPreparationStore(database, courseId).read()
        )
      ).toMatchObject({ id: operation.id, status: 'FAILED' });
      expect(
        await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
      ).toMatchObject({
        status: 'IN_PROGRESS',
        learnerAnswers: answers,
        adaptiveSeed: { teaching: sampleTeaching },
      });
      expect(
        await instance.database.lessonQuestion.findMany({
          where: { sectionId: target.id },
          orderBy: { order: 'asc' },
        })
      ).toEqual(target.questions);
      expect(
        await instance.database.classSection.count({ where: { classId: cls.id, attempt: 3 } })
      ).toBe(0);
    });

    it('restores retained reading material after settled failure and safely admits another new attempt', async () => {
      const { instance, courseId, execution } = context();
      const { cls, target, retained, answers, input } = await fixture('READING');
      const operation = await requestClassPreparation(courseId, execution, input);
      await instance.database.classSection.create({
        data: {
          classId: cls.id,
          skill: 'READING',
          attempt: 3,
          seed: randomUUID(),
          spec: {},
          status: 'GENERATING',
        },
      });
      await instance.database.courseClass.update({
        where: { id: cls.id },
        data: { readingVocabulary: { passageText: 'Unpublished replacement' } },
      });
      await sottoTransaction(instance.database, async (database) => {
        const parent = await sottoJobOutbox(database).read(operation.id);
        if (!parent) throw new Error('Missing admitted parent');
        await recordClassPreparationFailure(database, operation, parent.fingerprint, false);
      });
      expect(await readPreparationActivity(courseId, execution)).toMatchObject({
        status: 'FAILED',
      });
      const restored = await instance.database.courseClass.findUniqueOrThrow({
        where: { id: cls.id },
      });
      expect(restored).toMatchObject({
        status: 'IN_PROGRESS',
        attempt: 3,
        learnerAnswers: answers,
        readingVocabulary: cls.readingVocabulary,
        writingDrafts: cls.writingDrafts,
      });
      expect(
        await instance.database.classSection.findMany({ where: { classId: cls.id, attempt: 3 } })
      ).toEqual([]);
      expect(
        await instance.database.classSection.findUnique({ where: { id: retained.id } })
      ).toEqual(retained);
      expect(
        await instance.database.lessonQuestion.count({ where: { sectionId: target.id } })
      ).toBe(5);
      const next = await requestClassPreparation(courseId, execution, {
        intent: {
          ...input.intent,
          expectedAttempt: restored.attempt,
          retry: { sectionId: target.id, expectedRevision: restored.progressRevision },
        },
      });
      expect(next.id).not.toBe(operation.id);
      expect(next.intent).toMatchObject({ skills: ['READING'], attempt: 4 });
    });

    it('keeps uncertain provider outcomes fenced and preserves the original work', async () => {
      const { instance, courseId, execution } = context();
      const { cls, answers, input } = await fixture();
      const operation = await requestClassPreparation(courseId, execution, input);
      await sottoTransaction(instance.database, async (database) => {
        const parent = await sottoJobOutbox(database).read(operation.id);
        if (!parent) throw new Error('Missing admitted parent');
        await recordClassPreparationFailure(database, operation, parent.fingerprint, true);
      });
      await expect(requestClassPreparation(courseId, execution, input)).rejects.toBeInstanceOf(
        PreparationConflictError
      );
      expect(
        await sottoTransaction(instance.database, (database) =>
          classPreparationStore(database, courseId).read()
        )
      ).toMatchObject({ id: operation.id, status: 'UNRESOLVED' });
      expect(
        await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
      ).toMatchObject({ status: 'GENERATING', learnerAnswers: answers });
    });
  });
}
