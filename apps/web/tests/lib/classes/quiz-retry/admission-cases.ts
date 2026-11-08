import { randomUUID } from 'node:crypto';
import { createSkillRequirements } from '@sotto/shared';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import {
  classPreparationStore,
  recordClassPreparationFailure,
  requestClassPreparation,
  readPreparationActivity,
  validateClassPreparation,
  recoverClassPreparation,
  settleCancelledPreparation,
} from '@/lib/classes/preparation';
import { PreparationConflictError } from '@/lib/classes/preparation-state';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { classPreparationGrant } from '@/lib/classes/preparation-grant';
import { processClassPreparation } from '@/workers/classes/class-preparation.worker';
import { stageClassReading } from '@/lib/classes/staging/staged-reading';
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
    it.each(['request', 'recover'] as const)(
      'persists unresolved cleanup before returning a %s conflict',
      async (entry) => {
        const { instance, courseId, execution } = context();
        const { cls, input } = await fixture('READING');
        const operation = await requestClassPreparation(courseId, execution, input);
        const competing = await instance.database.classSection.create({
          data: {
            classId: cls.id,
            skill: 'READING',
            attempt: 3,
            seed: randomUUID(),
            spec: {},
            status: 'GENERATING',
          },
        });
        await sottoTransaction(instance.database, async (database) => {
          const parent = await sottoJobOutbox(database).read(operation.id);
          if (!parent) throw new Error('Missing admitted parent');
          await recordClassPreparationFailure(database, operation, parent.fingerprint, false);
        });
        if (entry === 'request')
          await expect(requestClassPreparation(courseId, execution, input)).rejects.toBeInstanceOf(
            PreparationConflictError
          );
        else
          await expect(
            recoverClassPreparation(courseId, execution, { acknowledgeUnknownOutcome: true })
          ).rejects.toBeInstanceOf(PreparationConflictError);
        expect((await classPreparationStore(instance.database, courseId).read())?.status).toBe(
          'UNRESOLVED'
        );
        expect(
          await instance.database.classSection.findUnique({ where: { id: competing.id } })
        ).not.toBeNull();
      }
    );

    it('fails a legacy reading repair without a retained-material receipt before provider work', async () => {
      const { instance, courseId, execution, queuedJob } = context();
      const { cls, target, answers, input } = await fixture('READING');
      const operation = await requestClassPreparation(courseId, execution, input);
      await classPreparationStore(instance.database, courseId).transact((current) => {
        if (!current?.intent) throw new Error('Missing operation');
        delete current.intent.retainedQuiz;
      });
      await processClassPreparation(await queuedJob(operation.id));
      expect((await classPreparationStore(instance.database, courseId).read())?.status).toBe(
        'FAILED'
      );
      expect(
        await instance.database.classReadingStage.count({ where: { operationId: operation.id } })
      ).toBe(0);
      expect(
        (await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } }))
          .learnerAnswers
      ).toEqual(answers);
      expect(
        await instance.database.lessonQuestion.count({ where: { sectionId: target.id } })
      ).toBe(5);
    });

    it('rechecks retry eligibility when a section changes during admission', async () => {
      const { instance, courseId, execution } = context();
      const { cls, target, input } = await fixture();
      let releaseWriter!: () => void;
      let writerReady!: (pid: number) => void;
      const release = new Promise<void>((resolve) => {
        releaseWriter = resolve;
      });
      const ready = new Promise<number>((resolve) => {
        writerReady = resolve;
      });
      const writer = instance.database.$transaction(async (database) => {
        const [{ pid }] = await database.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pg_backend_pid() AS pid`;
        await database.classSection.update({ where: { id: target.id }, data: { passed: true } });
        writerReady(pid!);
        await release;
      });
      const writerPid = await ready;
      const pending = requestClassPreparation(courseId, execution, input).then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      );
      let blocked = false;
      try {
        for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
          const [row] = await instance.database.$queryRaw<Array<{ blocked: boolean }>>`
            SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${writerPid} = ANY(pg_blocking_pids(pid))) AS blocked
          `;
          blocked = row?.blocked === true;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
      } finally {
        releaseWriter();
        await writer;
      }
      const result = await pending;
      expect(result).toHaveProperty('error');
      expect(
        (await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })).status
      ).toBe('IN_PROGRESS');
      expect(await classPreparationStore(instance.database, courseId).read()).toBeNull();
    });

    it('rejects a stale transaction when the saved section passes before authorization', async () => {
      const { instance, courseId, execution } = context();
      const { cls, target, input } = await fixture();
      const operation = await requestClassPreparation(courseId, execution, input);
      await classPreparationStore(instance.database, courseId).transact((current) => {
        if (!current || current.id !== operation.id) throw new Error('Missing operation');
        current.status = 'RUNNING';
      });
      let resume!: () => void;
      let observed!: () => void;
      const paused = new Promise<void>((resolve) => {
        observed = resolve;
      });
      const release = new Promise<void>((resolve) => {
        resume = resolve;
      });
      let first = true;
      const pending = sottoTransaction(instance.database, async (database) => {
        await database.courseClass.findUniqueOrThrow({ where: { id: cls.id } });
        if (first) {
          first = false;
          observed();
          await release;
        }
        return validateClassPreparation(database, courseId, operation.id);
      });
      await paused;
      try {
        await instance.database.classSection.update({
          where: { id: target.id },
          data: { passed: true },
        });
      } finally {
        resume();
      }
      await expect(pending).rejects.toThrow('The saved quiz retry source changed.');
    });

    it.each(['current question', 'historical question', 'answer', 'revision', 'passed'] as const)(
      'rejects retry authority when the admitted %s changes',
      async (changed) => {
        const { instance, courseId, execution } = context();
        const { cls, target, previous, answers, input } = await fixture();
        const operation = await requestClassPreparation(courseId, execution, input);
        expect(operation.intent?.retry?.sourceReceipt).toMatchObject({ version: 1 });
        await classPreparationStore(instance.database, courseId).transact((current) => {
          if (!current || current.id !== operation.id) throw new Error('Missing operation');
          current.status = 'RUNNING';
        });
        const validate = () =>
          sottoTransaction(instance.database, (database) =>
            validateClassPreparation(database, courseId, operation.id)
          );
        await expect(validate()).resolves.toBeDefined();
        if (changed === 'current question' || changed === 'historical question')
          await instance.database.lessonQuestion.update({
            where: {
              id:
                changed === 'current question'
                  ? target.questions[0]!.id
                  : previous.questions[0]!.id,
            },
            data: { explanation: 'Changed after retry admission.' },
          });
        if (changed === 'answer')
          await instance.database.courseClass.update({
            where: { id: cls.id },
            data: { learnerAnswers: { ...answers, [target.questions[0]!.id]: 1 } },
          });
        if (changed === 'revision')
          await instance.database.courseClass.update({
            where: { id: cls.id },
            data: { progressRevision: { increment: 1 } },
          });
        if (changed === 'passed')
          await instance.database.classSection.update({
            where: { id: target.id },
            data: { passed: true },
          });
        await expect(validate()).rejects.toThrow('The saved quiz retry source changed.');
        expect(
          await instance.database.lessonQuestion.count({ where: { sectionId: target.id } })
        ).toBe(5);
      }
    );

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

    it('keeps newer reading vocabulary when a retry fails before staging', async () => {
      const { instance, courseId, execution } = context();
      const { cls, target, answers, input } = await fixture('READING');
      const operation = await requestClassPreparation(courseId, execution, input);
      const newer = { passageText: 'Newer reading vocabulary' };
      await instance.database.courseClass.update({
        where: { id: cls.id },
        data: { readingVocabulary: newer },
      });
      await sottoTransaction(instance.database, async (database) => {
        const parent = await sottoJobOutbox(database).read(operation.id);
        if (!parent) throw new Error('Missing admitted parent');
        await recordClassPreparationFailure(database, operation, parent.fingerprint, false);
      });
      expect(await readPreparationActivity(courseId, execution)).toMatchObject({
        status: 'FAILED',
      });
      expect(
        await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
      ).toMatchObject({ status: 'IN_PROGRESS', readingVocabulary: newer, learnerAnswers: answers });
      expect(
        await instance.database.lessonQuestion.count({ where: { sectionId: target.id } })
      ).toBe(5);
    });

    it('leaves a legacy reading retry unresolved if its vocabulary changed', async () => {
      const { instance, courseId, execution } = context();
      const { cls, answers, input } = await fixture('READING');
      const operation = await requestClassPreparation(courseId, execution, input);
      await classPreparationStore(instance.database, courseId).transact((current) => {
        if (!current?.intent?.retry) throw new Error('Missing retry');
        delete current.intent.retainedQuiz;
        delete current.intent.retry.sourceReceipt;
      });
      const newer = { passageText: 'Unknown legacy vocabulary' };
      await instance.database.courseClass.update({
        where: { id: cls.id },
        data: { readingVocabulary: newer },
      });
      await sottoTransaction(instance.database, async (database) => {
        const parent = await sottoJobOutbox(database).read(operation.id);
        if (!parent) throw new Error('Missing admitted parent');
        await recordClassPreparationFailure(database, operation, parent.fingerprint, false);
      });
      expect(await readPreparationActivity(courseId, execution)).toMatchObject({
        status: 'UNRESOLVED',
      });
      expect(
        await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
      ).toMatchObject({ status: 'GENERATING', readingVocabulary: newer, learnerAnswers: answers });
    });

    it('keeps unowned partial sections and newer reading vocabulary unresolved', async () => {
      const { instance, courseId, execution } = context();
      const { cls, target, retained, answers, input } = await fixture('READING');
      const operation = await requestClassPreparation(courseId, execution, input);
      const competing = await instance.database.classSection.create({
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
        status: 'UNRESOLVED',
      });
      const restored = await instance.database.courseClass.findUniqueOrThrow({
        where: { id: cls.id },
      });
      expect(restored).toMatchObject({
        status: 'GENERATING',
        attempt: 3,
        learnerAnswers: answers,
        readingVocabulary: { passageText: 'Unpublished replacement' },
        writingDrafts: cls.writingDrafts,
      });
      expect(
        await instance.database.classSection.findMany({ where: { classId: cls.id, attempt: 3 } })
      ).toEqual([competing]);
      expect(
        await instance.database.classSection.findUnique({ where: { id: retained.id } })
      ).toEqual(retained);
      expect(
        await instance.database.lessonQuestion.count({ where: { sectionId: target.id } })
      ).toBe(5);
      await expect(
        requestClassPreparation(courseId, execution, {
          intent: {
            ...input.intent,
            expectedAttempt: restored.attempt,
            retry: { sectionId: target.id, expectedRevision: restored.progressRevision },
          },
        })
      ).rejects.toBeInstanceOf(PreparationConflictError);
    });

    it.each(['delete', 'reassign', 'insert'] as const)(
      'keeps retry work safe when a stage %s races cleanup',
      async (mutation) => {
        const { instance, courseId, execution } = context();
        const { cls, target, answers, input } = await fixture('READING');
        const operation = await requestClassPreparation(courseId, execution, input);
        const staged = await instance.database.classSection.create({
          data: {
            classId: cls.id,
            skill: 'READING',
            attempt: 3,
            seed: randomUUID(),
            spec: {},
            status: 'READY',
            withdrawn: true,
          },
        });
        const stageData = {
          sectionId: staged.id,
          operationId: operation.id,
          incarnationId: staged.incarnationId,
          version: 1,
          source: {},
          vocabulary: {},
          materialHash: 'a'.repeat(64),
        };
        if (mutation !== 'insert')
          await instance.database.classReadingStage.create({ data: stageData });
        await sottoTransaction(instance.database, async (database) => {
          const parent = await sottoJobOutbox(database).read(operation.id);
          if (!parent) throw new Error('Missing admitted parent');
          await recordClassPreparationFailure(database, operation, parent.fingerprint, false);
        });
        let locked!: (pid: number) => void;
        let release!: () => void;
        const ready = new Promise<number>((resolve) => {
          locked = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const writer = instance.database.$transaction(
          async (database) => {
            const [{ pid }] = await database.$queryRaw<
              Array<{ pid: number }>
            >`SELECT pg_backend_pid() AS pid`;
            if (mutation === 'insert')
              await database.$queryRaw`SELECT id FROM "ClassSection" WHERE id = ${staged.id} FOR UPDATE`;
            else
              await database.$queryRaw`SELECT "sectionId" FROM "ClassReadingStage" WHERE "sectionId" = ${staged.id} FOR UPDATE`;
            locked(pid!);
            await gate;
            if (mutation === 'insert') await database.classReadingStage.create({ data: stageData });
            if (mutation === 'delete')
              await database.classReadingStage.delete({ where: { sectionId: staged.id } });
            if (mutation === 'reassign')
              await database.classReadingStage.update({
                where: { sectionId: staged.id },
                data: { operationId: randomUUID() },
              });
          },
          { timeout: 15_000 }
        );
        const pid = await ready;
        const cleanup = readPreparationActivity(courseId, execution);
        let blocked = false;
        try {
          for (let attempt = 0; attempt < 200 && !blocked; attempt++) {
            const [{ waiting }] = await instance.database.$queryRaw<Array<{ waiting: boolean }>>`
              SELECT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE ${pid} = ANY(pg_blocking_pids(a.pid))) AS waiting`;
            blocked = waiting;
            if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
          }
        } finally {
          release();
        }
        expect(blocked).toBe(true);
        await writer;
        const activity = await cleanup;
        expect(activity?.status).toBe('UNRESOLVED');
        const saved = await instance.database.courseClass.findUniqueOrThrow({
          where: { id: cls.id },
        });
        expect(saved.learnerAnswers).toEqual(answers);
        expect(saved.writingDrafts).toEqual(cls.writingDrafts);
        expect(saved.status).toBe('GENERATING');
        expect(
          await instance.database.lessonQuestion.count({ where: { sectionId: target.id } })
        ).toBe(5);
        const stage = await instance.database.classReadingStage.findUnique({
          where: { sectionId: staged.id },
        });
        if (mutation === 'delete') expect(stage).toBeNull();
        if (mutation === 'insert') expect(stage?.operationId).toBe(operation.id);
        if (mutation === 'reassign') expect(stage?.operationId).not.toBe(operation.id);
        expect(
          await instance.database.classSection.findUniqueOrThrow({ where: { id: staged.id } })
        ).toMatchObject({ withdrawn: true });
      },
      30_000
    );

    it('preserves grammar retry work when its stage is reassigned during cleanup', async () => {
      const { instance, courseId, execution } = context();
      const { cls, target, answers, input } = await fixture('GRAMMAR');
      const operation = await requestClassPreparation(courseId, execution, input);
      const staged = await instance.database.classSection.create({
        data: {
          classId: cls.id,
          skill: 'GRAMMAR',
          attempt: 3,
          seed: randomUUID(),
          spec: {},
          status: 'READY',
          withdrawn: true,
        },
      });
      await instance.database.classGrammarStage.create({
        data: {
          sectionId: staged.id,
          operationId: operation.id,
          incarnationId: staged.incarnationId,
          version: 1,
          sourceHash: 'a'.repeat(64),
          materialHash: 'b'.repeat(64),
        },
      });
      await sottoTransaction(instance.database, async (database) => {
        const parent = await sottoJobOutbox(database).read(operation.id);
        if (!parent) throw new Error('Missing admitted parent');
        await recordClassPreparationFailure(database, operation, parent.fingerprint, false);
      });
      let locked!: (pid: number) => void;
      let release!: () => void;
      const ready = new Promise<number>((resolve) => {
        locked = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const replacementId = randomUUID();
      const writer = instance.database.$transaction(
        async (database) => {
          const [{ pid }] = await database.$queryRaw<
            Array<{ pid: number }>
          >`SELECT pg_backend_pid() AS pid`;
          await database.$queryRaw`SELECT "sectionId" FROM "ClassGrammarStage" WHERE "sectionId" = ${staged.id} FOR UPDATE`;
          locked(pid!);
          await gate;
          await database.classGrammarStage.update({
            where: { sectionId: staged.id },
            data: { operationId: replacementId },
          });
        },
        { timeout: 15_000 }
      );
      const pid = await ready;
      const cleanup = readPreparationActivity(courseId, execution);
      let blocked = false;
      try {
        for (let attempt = 0; attempt < 200 && !blocked; attempt++) {
          const [{ waiting }] = await instance.database.$queryRaw<Array<{ waiting: boolean }>>`
            SELECT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE ${pid} = ANY(pg_blocking_pids(a.pid))) AS waiting`;
          blocked = waiting;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        release();
      }
      expect(blocked).toBe(true);
      await writer;
      expect((await cleanup)?.status).toBe('UNRESOLVED');
      expect(
        await instance.database.classGrammarStage.findUniqueOrThrow({
          where: { sectionId: staged.id },
        })
      ).toMatchObject({ operationId: replacementId });
      expect(
        await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
      ).toMatchObject({
        status: 'GENERATING',
        learnerAnswers: answers,
        writingDrafts: cls.writingDrafts,
      });
      expect(
        await instance.database.lessonQuestion.count({ where: { sectionId: target.id } })
      ).toBe(5);
      expect(
        await instance.database.classSection.findUniqueOrThrow({ where: { id: staged.id } })
      ).toMatchObject({ withdrawn: true });
    }, 30_000);

    it.each(['delete', 'reassign', 'insert'] as const)(
      'keeps retry work safe when cleanup locks before an independent stage %s',
      async (mutation) => {
        const { instance, courseId, execution } = context();
        const { cls, answers, input } = await fixture('READING');
        const operation = await requestClassPreparation(courseId, execution, input);
        const staged = await instance.database.classSection.create({
          data: {
            classId: cls.id,
            skill: 'READING',
            attempt: 3,
            seed: randomUUID(),
            spec: {},
            status: 'READY',
            withdrawn: true,
          },
        });
        const stageData = {
          sectionId: staged.id,
          operationId: operation.id,
          incarnationId: staged.incarnationId,
          version: 1,
          source: {},
          vocabulary: {},
          materialHash: 'a'.repeat(64),
        };
        if (mutation !== 'insert')
          await instance.database.classReadingStage.create({ data: stageData });
        await sottoTransaction(instance.database, async (database) => {
          const parent = await sottoJobOutbox(database).read(operation.id);
          if (!parent) throw new Error('Missing admitted parent');
          await recordClassPreparationFailure(database, operation, parent.fingerprint, false);
        });
        let locked!: () => void;
        let release!: () => void;
        let reportPid!: (pid: number) => void;
        const ready = new Promise<void>((resolve) => {
          locked = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const pidReady = new Promise<number>((resolve) => {
          reportPid = resolve;
        });
        const cleanup = instance.database.$transaction(
          async (database) => {
            const current = await classPreparationStore(database, courseId).read();
            if (!current) throw new Error('Missing preparation');
            const result = await settleCancelledPreparation(database, current);
            locked();
            await gate;
            return result;
          },
          { isolationLevel: 'Serializable', timeout: 15_000 }
        );
        await ready;
        const writer = instance.database.$transaction(
          async (database) => {
            const [{ pid }] = await database.$queryRaw<
              Array<{ pid: number }>
            >`SELECT pg_backend_pid() AS pid`;
            reportPid(pid!);
            if (mutation === 'insert') await database.classReadingStage.create({ data: stageData });
            if (mutation === 'delete')
              await database.classReadingStage.delete({ where: { sectionId: staged.id } });
            if (mutation === 'reassign')
              await database.classReadingStage.update({
                where: { sectionId: staged.id },
                data: { operationId: randomUUID() },
              });
          },
          { timeout: 15_000 }
        );
        const pid = await pidReady;
        let reportPartyPid!: (pid: number) => void;
        const partyPidReady = new Promise<number>((resolve) => {
          reportPartyPid = resolve;
        });
        const firstParty = sottoTransaction(instance.database, async (database) => {
          const [{ pid: partyPid }] = await database.$queryRaw<
            Array<{ pid: number }>
          >`SELECT pg_backend_pid() AS pid`;
          reportPartyPid(partyPid!);
          await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
          await stageClassReading(database, operation, {
            classId: cls.id,
            attempt: 3,
            sectionId: staged.id,
            source: {
              digest: 'a'.repeat(64),
              progressRevision: 8,
              readingVocabulary: null,
              passage: null,
            },
            vocabulary: { passageText: '', sourceHash: 'a'.repeat(64), words: [] },
          });
        }).then(
          () => null,
          (error: unknown) => error
        );
        const partyPid = await partyPidReady;
        let blocked = false;
        let partyBlocked = false;
        try {
          for (let attempt = 0; attempt < 200 && (!blocked || !partyBlocked); attempt++) {
            const [{ waiting, partyWaiting }] = await instance.database.$queryRaw<
              Array<{ waiting: boolean; partyWaiting: boolean }>
            >`
              SELECT cardinality(pg_blocking_pids(${pid})) > 0 AS waiting,
                cardinality(pg_blocking_pids(${partyPid})) > 0 AS "partyWaiting"`;
            blocked = waiting;
            partyBlocked = partyWaiting;
            if (!blocked || !partyBlocked) await new Promise((resolve) => setTimeout(resolve, 10));
          }
        } finally {
          release();
        }
        expect(blocked).toBe(true);
        expect(partyBlocked).toBe(true);
        const result = await cleanup;
        if (mutation === 'insert') expect(result.status).toBe('UNRESOLVED');
        await writer;
        expect(await firstParty).toMatchObject({
          message: 'The preparation task is no longer authorized.',
        });
        const stageAfterWriter = await instance.database.classReadingStage.findUnique({
          where: { sectionId: staged.id },
        });
        await expect(
          sottoTransaction(instance.database, (database) =>
            stageClassReading(database, operation, {
              classId: cls.id,
              attempt: 3,
              sectionId: staged.id,
              source: {
                digest: 'a'.repeat(64),
                progressRevision: 8,
                readingVocabulary: null,
                passage: null,
              },
              vocabulary: { passageText: '', sourceHash: 'a'.repeat(64), words: [] },
            })
          )
        ).rejects.toThrow('The preparation task is no longer authorized.');
        expect(
          await instance.database.classReadingStage.findUnique({ where: { sectionId: staged.id } })
        ).toEqual(stageAfterWriter);
        const saved = await instance.database.courseClass.findUniqueOrThrow({
          where: { id: cls.id },
        });
        expect(saved.learnerAnswers).toEqual(answers);
        expect(saved.writingDrafts).toEqual(cls.writingDrafts);
        expect(saved.status).toBe(mutation === 'insert' ? 'GENERATING' : 'IN_PROGRESS');
        expect(
          await instance.database.classSection.findUniqueOrThrow({ where: { id: staged.id } })
        ).toMatchObject({ withdrawn: true });
      },
      30_000
    );

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
