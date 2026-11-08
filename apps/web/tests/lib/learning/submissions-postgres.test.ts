// @vitest-environment node
// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { submitClass as submitAuthorizedClass } from '@/lib/learning/classes/progress/class-submission';
import { authorizedLearnerExecution } from '../../helpers/runtime/provider-execution';
import {
  saveLearningProgress as saveAuthorizedProgress,
  LearningProgressConflict,
} from '@/lib/learning/progress';
import { createSubmissionFixture } from './submissions/fixtures';
import { registerSubmissionCases } from './submissions/cases/submission-cases';
import {
  classTaskMaterialHash,
  initialA1MaterialHash,
} from '@/lib/classes/lesson/initial-a1-provenance';
import { createPrerequisiteTokenizer } from '@/lib/classes/help/content/prerequisite-token';
import { classProgressRevision } from '@/lib/learning/classes/progress/progress-revision';
import { sampleTeaching } from '../../helpers/learning/class-teaching';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireAssessmentPracticeComplete } from '@/lib/learning/classes/practice/assessment-practice';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import {
  admitWritingExecution,
  runWritingExecution,
} from '@/lib/learning/writing/writing-execution';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const saveLearningProgress = (
  kind: 'CLASS' | 'PRACTICE',
  id: string,
  userId: string,
  progress: Parameters<typeof saveAuthorizedProgress>[3]
) => saveAuthorizedProgress(kind, id, userId, progress, authorizedLearnerExecution(userId));
const submitClass = (
  classId: string,
  userId: string,
  answers: Array<{ questionId: string; selectedIndex: number }>
) => submitAuthorizedClass(classId, userId, answers, authorizedLearnerExecution(userId));
suite('Complete learning submissions against PostgreSQL', () => {
  const fixture = createSubmissionFixture(binding, 'learning_submission');
  it('preserves earlier class answers and drafts when saving current work', async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'progress-test-key');
    try {
      const cls = await fixture.seedClass(fixture.requirements('CLASS', false, false));
      const oldPrompt = await fixture.instance.database.writingPrompt.findFirstOrThrow({
        where: { section: { classId: cls.id } },
      });
      const grammar = await fixture.instance.database.classSection.create({
        data: {
          classId: cls.id,
          skill: 'GRAMMAR',
          attempt: 2,
          status: 'READY',
          seed: 'new-grammar',
          spec: {},
          questions: {
            create: {
              order: 1,
              skill: 'GRAMMAR',
              question: 'A new question?',
              options: ['A', 'B', 'C', 'D'],
              correctIndex: 0,
              explanation: 'A is correct.',
            },
          },
        },
        include: { questions: true },
      });
      const writing = await fixture.instance.database.classSection.create({
        data: {
          classId: cls.id,
          skill: 'WRITING',
          attempt: 2,
          status: 'READY',
          seed: 'new-writing',
          spec: {},
          writingPrompts: { create: { order: 1, task: 'Write a greeting.' } },
        },
        include: { writingPrompts: true },
      });
      const oldQuestion = (
        await fixture.instance.database.lessonQuestion.findFirstOrThrow({
          where: { section: { classId: cls.id, skill: 'GRAMMAR', attempt: 1 } },
        })
      ).id;
      const newQuestion = grammar.questions[0]!.id;
      const newPrompt = writing.writingPrompts[0]!.id;
      await fixture.instance.database.courseClass.update({
        where: { id: cls.id },
        data: {
          attempt: 2,
          learnerAnswers: { [oldQuestion]: 1 },
          writingDrafts: { [oldPrompt.id]: 'Earlier work' },
        },
      });
      const revision = await classProgressRevision(
        fixture.instance.database,
        cls.id,
        fixture.userId
      );
      await saveLearningProgress('CLASS', cls.id, fixture.userId, {
        expectedRevision: 0,
        expectedAttempt: 2,
        taskMaterialRevision: revision.revision,
        answers: { [newQuestion]: 0 },
        writingDrafts: { [newPrompt]: 'New work' },
      });
      const saved = await fixture.instance.database.courseClass.findUniqueOrThrow({
        where: { id: cls.id },
      });
      expect(saved.learnerAnswers).toEqual({ [oldQuestion]: 1, [newQuestion]: 0 });
      expect(saved.writingDrafts).toEqual({
        [oldPrompt.id]: 'Earlier work',
        [newPrompt]: 'New work',
      });
      await expect(
        saveLearningProgress('CLASS', cls.id, fixture.userId, {
          expectedRevision: 1,
          expectedAttempt: 2,
          taskMaterialRevision: revision.revision,
          answers: { [oldQuestion]: 0 },
        })
      ).rejects.toThrow('different learning material');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each(['answers', 'drafts'] as const)(
    'does not overwrite malformed saved class %s',
    async (kind) => {
      vi.stubEnv('BYOK_ENCRYPTION_KEY', 'progress-test-key');
      try {
        const cls = await fixture.seedClass(fixture.requirements('CLASS', false, false));
        const prompt = await fixture.instance.database.writingPrompt.findFirstOrThrow({
          where: { section: { classId: cls.id } },
        });
        const corrupt = {
          saved: kind === 'answers' ? 1 : 'Keep this',
          invalid: kind === 'answers' ? 'invalid' : 42,
        };
        await fixture.instance.database.courseClass.update({
          where: { id: cls.id },
          data: kind === 'answers' ? { learnerAnswers: corrupt } : { writingDrafts: corrupt },
        });
        const revision = await classProgressRevision(
          fixture.instance.database,
          cls.id,
          fixture.userId
        );
        await expect(
          saveLearningProgress('CLASS', cls.id, fixture.userId, {
            expectedRevision: 0,
            expectedAttempt: 1,
            taskMaterialRevision: revision.revision,
            ...(kind === 'answers'
              ? { answers: { [cls.answers[0]!.questionId]: 0 } }
              : { writingDrafts: { [prompt.id]: 'New draft' } }),
          })
        ).rejects.toThrow('need recovery');
        const saved = await fixture.instance.database.courseClass.findUniqueOrThrow({
          where: { id: cls.id },
        });
        expect(kind === 'answers' ? saved.learnerAnswers : saved.writingDrafts).toEqual(corrupt);
      } finally {
        vi.unstubAllEnvs();
      }
    }
  );
  it('requires current saved practice and the latest feedback across required skills', async () => {
    const cls = await fixture.seedClass(fixture.requirements('CLASS', true, true));
    const check = (userId = fixture.userId, classAttempt = 1) =>
      sottoTransaction(fixture.instance.database, (tx) =>
        requireAssessmentPracticeComplete(tx, { classId: cls.id, classAttempt, userId })
      );
    await expect(check()).rejects.toThrow('grammar practice');
    await fixture.instance.database.courseClass.update({
      where: { id: cls.id },
      data: {
        learnerAnswers: Object.fromEntries(cls.answers.map((answer) => [answer.questionId, 1])),
      },
    });
    await fixture.instance.database.writingResponse.updateMany({
      where: { prompt: { section: { classId: cls.id } } },
      data: { overallScore: 0.1 },
    });
    await expect(check()).resolves.toBeUndefined();
    const response = await fixture.instance.database.writingResponse.findFirstOrThrow({
      where: { prompt: { section: { classId: cls.id } } },
    });
    await fixture.instance.database.writingResponse.update({
      where: { id: response.id },
      data: { gradingState: { status: 'COMPLETED' } },
    });
    await expect(check()).rejects.toThrow('writing practice');
    const operation = await sottoTransaction(fixture.instance.database, (tx) =>
      admitWritingExecution(tx, {
        responseId: response.id,
        courseId: fixture.courseId,
        execution: authorizedLearnerExecution(fixture.userId),
        selection: { provider: 'fixture', model: 'fixture', credentialFingerprint: null },
        classAuthorization: null,
      })
    );
    await fixture.instance.database.writingResponse.update({
      where: { id: response.id },
      data: { gradingState: { ...operation, status: 'COMPLETED' } },
    });
    await expect(check()).rejects.toThrow('writing practice');
    await sottoTransaction(fixture.instance.database, async (tx) => {
      await sottoJobOutbox(tx).complete(operation.id, operation.fingerprint);
    });
    await expect(check()).rejects.toThrow('writing practice');
    await sottoTransaction(fixture.instance.database, (tx) =>
      learningPreparationGrant(tx, operation, 'writing').complete(operation.grant)
    );
    await expect(check()).rejects.toThrow('writing practice');
    const realOperation = await sottoTransaction(fixture.instance.database, (tx) =>
      admitWritingExecution(tx, {
        responseId: response.id,
        courseId: fixture.courseId,
        execution: authorizedLearnerExecution(fixture.userId),
        selection: { provider: 'fixture', model: 'fixture', credentialFingerprint: null },
        classAuthorization: null,
      })
    );
    const root = await mkdtemp(join(tmpdir(), 'sotto-practice-writing-'));
    const previousDirectory = process.env.SIDEDOOR_EXECUTION_DIR;
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(root, 'executions'));
    try {
      await runWritingExecution({
        responseId: response.id,
        operation: realOperation,
        execution: authorizedLearnerExecution(fixture.userId),
        validate: async () => {},
        grade: async () => ({ overallScore: 0.1, corrections: [], feedback: 'Keep trying.' }),
        publish: async (tx, grade) => {
          await tx.writingResponse.update({
            where: { id: response.id },
            data: { overallScore: grade.overallScore, corrections: [], feedback: grade.feedback },
          });
        },
      });
    } finally {
      if (previousDirectory === undefined) delete process.env.SIDEDOOR_EXECUTION_DIR;
      else process.env.SIDEDOOR_EXECUTION_DIR = previousDirectory;
      await rm(root, { recursive: true, force: true });
    }
    await expect(check()).resolves.toBeUndefined();
    const authorityRows = await fixture.instance.database.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SidedoorState"
      WHERE (id LIKE 'sd-j:1:%' AND id LIKE ${`%:${realOperation.id}`})
         OR (id LIKE 'sd-jeg:1:%' AND id LIKE ${`%:${realOperation.id}`})
         OR (state->>'kind' = 'job_execution' AND state->>'parentId' = ${realOperation.id})
         OR id LIKE ${`%:writing-grant:${realOperation.id}`}`;
    expect(authorityRows).toHaveLength(4);
    for (const row of authorityRows) {
      const started = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      const stale = fixture.instance.database
        .$transaction(
          async (tx) => {
            await tx.courseClass.findUniqueOrThrow({ where: { id: cls.id } });
            started.resolve();
            await resume.promise;
            await requireAssessmentPracticeComplete(tx, {
              classId: cls.id,
              classAttempt: 1,
              userId: fixture.userId,
            });
          },
          { isolationLevel: 'Serializable', timeout: 15000 }
        )
        .then(
          () => null,
          (error: unknown) => error
        );
      await started.promise;
      try {
        await fixture.instance.database.$executeRaw`
          UPDATE "SidedoorState" SET revision = revision WHERE id = ${row.id}`;
      } finally {
        resume.resolve();
      }
      expect(isSerializationConflict(await stale), row.id).toBe(true);
    }
    await fixture.instance.database.writingResponse.update({
      where: { id: response.id },
      data: { text: 'Changed after grading' },
    });
    await expect(check()).rejects.toThrow('writing practice');
    await fixture.instance.database.writingResponse.update({
      where: { id: response.id },
      data: { text: response.text },
    });
    await expect(check()).resolves.toBeUndefined();
    const speaking = await fixture.instance.database.speakingPrompt.findFirstOrThrow({
      where: { section: { classId: cls.id } },
    });
    const pending = await fixture.instance.database.speakingRecording.create({
      data: {
        promptId: speaking.id,
        sectionId: speaking.sectionId,
        userId: fixture.userId,
        status: 'PENDING',
        audioUrl: '/owned/pending.webm',
        createdAt: new Date(Date.now() + 1000),
      },
    });
    await expect(check()).rejects.toThrow('speaking practice');
    await fixture.instance.database.speakingRecording.delete({ where: { id: pending.id } });
    await expect(check('another-learner')).rejects.toThrow('no longer available');
    await expect(check(fixture.userId, 2)).rejects.toThrow('no longer available');
    await expect(check()).resolves.toBeUndefined();
  });
  it.each(['writing', 'speaking'] as const)(
    'rejects an old practice snapshot after a new pending %s response commits',
    async (skill) => {
      const cls = await fixture.seedClass(fixture.requirements('CLASS', true, true));
      await fixture.instance.database.courseClass.update({
        where: { id: cls.id },
        data: {
          learnerAnswers: Object.fromEntries(cls.answers.map((answer) => [answer.questionId, 0])),
        },
      });
      const started = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      const stale = fixture.instance.database
        .$transaction(
          async (tx) => {
            await tx.courseClass.findUniqueOrThrow({ where: { id: cls.id } });
            started.resolve();
            await resume.promise;
            await requireAssessmentPracticeComplete(tx, {
              classId: cls.id,
              classAttempt: 1,
              userId: fixture.userId,
            });
          },
          { isolationLevel: 'Serializable', timeout: 15000 }
        )
        .then(
          () => null,
          (error: unknown) => error
        );
      await started.promise;
      try {
        if (skill === 'writing') {
          const prompt = await fixture.instance.database.writingPrompt.findFirstOrThrow({
            where: { section: { classId: cls.id } },
          });
          await fixture.instance.database.writingResponse.create({
            data: {
              promptId: prompt.id,
              sectionId: prompt.sectionId,
              userId: fixture.userId,
              text: 'Pending',
              createdAt: new Date(Date.now() + 1000),
            },
          });
        } else {
          const prompt = await fixture.instance.database.speakingPrompt.findFirstOrThrow({
            where: { section: { classId: cls.id } },
          });
          await fixture.instance.database.speakingRecording.create({
            data: {
              promptId: prompt.id,
              sectionId: prompt.sectionId,
              userId: fixture.userId,
              audioUrl: '/owned/pending.webm',
              status: 'PENDING',
              createdAt: new Date(Date.now() + 1000),
            },
          });
        }
      } finally {
        resume.resolve();
      }
      expect(isSerializationConflict(await stale)).toBe(true);
      await expect(
        sottoTransaction(fixture.instance.database, (tx) =>
          requireAssessmentPracticeComplete(tx, {
            classId: cls.id,
            classAttempt: 1,
            userId: fixture.userId,
          })
        )
      ).rejects.toThrow(`${skill} practice`);
    }
  );
  it.each(['writing', 'speaking'] as const)(
    'fences both classes when a %s response changes prompt',
    async (skill) => {
      const first = await fixture.seedClass(fixture.requirements('CLASS', true, true));
      const second = await fixture.seedClass(fixture.requirements('CLASS', true, true));
      await fixture.instance.database.courseClass.update({
        where: { id: second.id },
        data: {
          learnerAnswers: Object.fromEntries(
            second.answers.map((answer) => [answer.questionId, 0])
          ),
        },
      });
      const started = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      const sourceStarted = Promise.withResolvers<void>();
      const sourceStale = fixture.instance.database
        .$transaction(
          async (tx) => {
            await tx.courseClass.findUniqueOrThrow({ where: { id: first.id } });
            sourceStarted.resolve();
            await resume.promise;
            await tx.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${first.id} FOR UPDATE`;
          },
          { isolationLevel: 'Serializable', timeout: 15000 }
        )
        .then(
          () => null,
          (error: unknown) => error
        );
      const stale = fixture.instance.database
        .$transaction(
          async (tx) => {
            await tx.courseClass.findUniqueOrThrow({ where: { id: second.id } });
            started.resolve();
            await resume.promise;
            await requireAssessmentPracticeComplete(tx, {
              classId: second.id,
              classAttempt: 1,
              userId: fixture.userId,
            });
          },
          { isolationLevel: 'Serializable', timeout: 15000 }
        )
        .then(
          () => null,
          (error: unknown) => error
        );
      await Promise.all([started.promise, sourceStarted.promise]);
      try {
        if (skill === 'writing') {
          const previous = await fixture.instance.database.writingResponse.findFirstOrThrow({
            where: { prompt: { section: { classId: first.id } } },
          });
          const next = await fixture.instance.database.writingPrompt.findFirstOrThrow({
            where: { section: { classId: second.id } },
          });
          await fixture.instance.database.writingResponse.update({
            where: { id: previous.id },
            data: { promptId: next.id, createdAt: new Date(Date.now() + 1000) },
          });
        } else {
          const previous = await fixture.instance.database.speakingRecording.findFirstOrThrow({
            where: { prompt: { section: { classId: first.id } } },
          });
          const next = await fixture.instance.database.speakingPrompt.findFirstOrThrow({
            where: { section: { classId: second.id } },
          });
          await fixture.instance.database.speakingRecording.update({
            where: { id: previous.id },
            data: { promptId: next.id, createdAt: new Date(Date.now() + 1000) },
          });
        }
      } finally {
        resume.resolve();
      }
      expect(isSerializationConflict(await stale)).toBe(true);
      expect(isSerializationConflict(await sourceStale)).toBe(true);
      await expect(
        sottoTransaction(fixture.instance.database, (tx) =>
          requireAssessmentPracticeComplete(tx, {
            classId: second.id,
            classAttempt: 1,
            userId: fixture.userId,
          })
        )
      ).rejects.toThrow(`${skill} practice`);
    }
  );
  it.each(['writing', 'speaking'] as const)(
    'retries a class and %s feedback lock inversion',
    async (skill) => {
      const cls = await fixture.seedClass(fixture.requirements('CLASS', true, true));
      const row =
        skill === 'writing'
          ? await fixture.instance.database.writingResponse.findFirstOrThrow({
              where: { prompt: { section: { classId: cls.id } } },
            })
          : await fixture.instance.database.speakingRecording.findFirstOrThrow({
              where: { prompt: { section: { classId: cls.id } } },
            });
      const classReady = Promise.withResolvers<void>();
      const childReady = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let classAttempts = 0;
      let childAttempts = 0;
      const update = (tx: Prisma.TransactionClient) =>
        skill === 'writing'
          ? tx.writingResponse.update({ where: { id: row.id }, data: { feedback: 'Updated' } })
          : tx.speakingRecording.update({ where: { id: row.id }, data: { feedback: 'Updated' } });
      const first = sottoTransaction(fixture.instance.database, async (tx) => {
        classAttempts += 1;
        await tx.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
        if (classAttempts === 1) {
          classReady.resolve();
          await release.promise;
        }
        await update(tx);
      });
      const second = sottoTransaction(fixture.instance.database, async (tx) => {
        childAttempts += 1;
        if (skill === 'writing')
          await tx.$queryRaw`SELECT id FROM "WritingResponse" WHERE id = ${row.id} FOR UPDATE`;
        else await tx.$queryRaw`SELECT id FROM "SpeakingRecording" WHERE id = ${row.id} FOR UPDATE`;
        if (childAttempts === 1) {
          childReady.resolve();
          await release.promise;
        }
        await update(tx);
      });
      try {
        await Promise.all([classReady.promise, childReady.promise]);
      } finally {
        release.resolve();
      }
      await Promise.all([first, second]);
      expect(classAttempts + childAttempts).toBeGreaterThan(2);
    },
    20000
  );
  it('removes formative feedback when its class is deleted', async () => {
    const cls = await fixture.seedClass(fixture.requirements('CLASS', true, true));
    const writing = await fixture.instance.database.writingResponse.findMany({
      where: { prompt: { section: { classId: cls.id } } },
      select: { id: true },
    });
    const speaking = await fixture.instance.database.speakingRecording.findMany({
      where: { prompt: { section: { classId: cls.id } } },
      select: { id: true },
    });
    expect(writing.length).toBeGreaterThan(0);
    expect(speaking.length).toBeGreaterThan(0);
    await fixture.instance.database.courseClass.delete({ where: { id: cls.id } });
    expect(
      await fixture.instance.database.writingResponse.count({
        where: { id: { in: writing.map((item) => item.id) } },
      })
    ).toBe(0);
    expect(
      await fixture.instance.database.speakingRecording.count({
        where: { id: { in: speaking.map((item) => item.id) } },
      })
    ).toBe(0);
  });
  it('rejects saved class edits when exercise content changes without an id or revision change', async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'progress-test-key');
    try {
      const cls = await fixture.seedClass(fixture.requirements('CLASS', false, false));
      const hash = await classTaskMaterialHash(fixture.instance.database, cls.id, fixture.userId);
      const tokenizer = createPrerequisiteTokenizer(cls.id, fixture.userId);
      const taskMaterialRevision = tokenizer.material(hash);
      tokenizer.dispose();
      await expect(
        saveLearningProgress('CLASS', cls.id, fixture.userId, {
          expectedRevision: 0,
          answers: { [cls.answers[0]!.questionId]: 0 },
        })
      ).rejects.toThrow('needs a current material revision');
      const question = await fixture.instance.database.lessonQuestion.findUniqueOrThrow({
        where: { id: cls.answers[0].questionId },
      });
      await fixture.instance.database.lessonQuestion.update({
        where: { id: question.id },
        data: { question: 'A different question with the same identity.' },
      });
      await expect(
        saveLearningProgress('CLASS', cls.id, fixture.userId, {
          expectedRevision: 0,
          expectedAttempt: 1,
          taskMaterialRevision,
          answers: { [question.id]: 0 },
        })
      ).rejects.toThrow('class material changed');
      const saved = await fixture.instance.database.courseClass.findUniqueOrThrow({
        where: { id: cls.id },
      });
      expect(saved.progressRevision).toBe(0);
      expect(saved.learnerAnswers).toBeNull();
      await fixture.instance.database.lessonQuestion.update({
        where: { id: question.id },
        data: { question: question.question },
      });
      await expect(
        saveLearningProgress('CLASS', cls.id, fixture.userId, {
          expectedRevision: 0,
          expectedAttempt: 2,
          taskMaterialRevision,
          answers: { [question.id]: 0 },
        })
      ).rejects.toThrow('class attempt changed');
      await expect(
        saveAuthorizedProgress(
          'CLASS',
          cls.id,
          fixture.userId,
          {
            expectedRevision: 0,
            expectedAttempt: 1,
            taskMaterialRevision,
            answers: { [question.id]: 0 },
          },
          {
            userId: fixture.userId,
            authorize: async () => {
              throw new Error('Session revoked');
            },
          }
        )
      ).rejects.toThrow('Session revoked');
      expect(
        await saveLearningProgress('CLASS', cls.id, fixture.userId, {
          expectedRevision: 0,
          expectedAttempt: 1,
          taskMaterialRevision,
          answers: { [question.id]: 0 },
        })
      ).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('binds first-lesson progress to the exact acknowledged teaching receipt', async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'progress-test-key');
    try {
      const cls = await fixture.seedClass(fixture.requirements('CLASS', false, false), {
        firstA1: true,
      });
      await fixture.instance.database.courseClass.update({
        where: { id: cls.id },
        data: { adaptiveSeed: { teaching: sampleTeaching } },
      });
      const materialHash = await initialA1MaterialHash(
        fixture.instance.database,
        cls.id,
        fixture.userId
      );
      const firstReceipt = randomUUID();
      const gate = {
        version: 1,
        classId: cls.id,
        courseId: fixture.courseId,
        userId: fixture.userId,
        attempt: 1,
        receiptId: firstReceipt,
        materialHash,
      };
      const revision = () =>
        sottoTransaction(fixture.instance.database, (tx) =>
          classProgressRevision(tx, cls.id, fixture.userId)
        );
      const unacknowledged = await revision();
      expect(unacknowledged.access).toBe('BLOCKED');
      const changes = { expectedRevision: 0, answers: { [cls.answers[0]!.questionId]: 0 } };
      await expect(saveLearningProgress('CLASS', cls.id, fixture.userId, changes)).rejects.toThrow(
        'Review the prerequisite teaching'
      );
      await fixture.instance.database.courseClass.update({
        where: { id: cls.id },
        data: {
          prerequisiteGate: {
            ...gate,
            acknowledgment: { userId: fixture.userId, receiptId: firstReceipt, materialHash },
          },
        },
      });
      const first = await revision();
      expect(first.access).toBe('PROTECTED');
      expect(first.revision).not.toBe(unacknowledged.revision);
      await expect(saveLearningProgress('CLASS', cls.id, fixture.userId, changes)).rejects.toThrow(
        'needs a current material revision'
      );
      await expect(
        saveLearningProgress('CLASS', cls.id, fixture.userId, {
          ...changes,
          expectedAttempt: 1,
          taskMaterialRevision: unacknowledged.revision,
        })
      ).rejects.toThrow('class material changed');
      expect(
        await saveLearningProgress('CLASS', cls.id, fixture.userId, {
          ...changes,
          expectedAttempt: 1,
          taskMaterialRevision: first.revision,
        })
      ).toBe(1);
      const nextReceipt = randomUUID();
      await fixture.instance.database.courseClass.update({
        where: { id: cls.id },
        data: {
          prerequisiteGate: {
            ...gate,
            receiptId: nextReceipt,
            acknowledgment: { userId: fixture.userId, receiptId: nextReceipt, materialHash },
          },
        },
      });
      const next = await revision();
      expect(next.revision).not.toBe(first.revision);
      await expect(
        saveLearningProgress('CLASS', cls.id, fixture.userId, {
          ...changes,
          expectedRevision: 1,
          expectedAttempt: 1,
          taskMaterialRevision: first.revision,
        })
      ).rejects.toThrow('class material changed');
      expect(
        await saveLearningProgress('CLASS', cls.id, fixture.userId, {
          ...changes,
          expectedRevision: 1,
          expectedAttempt: 1,
          taskMaterialRevision: next.revision,
        })
      ).toBe(2);
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let firstAttempt = true;
      const stale = saveAuthorizedProgress(
        'CLASS',
        cls.id,
        fixture.userId,
        {
          ...changes,
          expectedRevision: 2,
          expectedAttempt: 1,
          taskMaterialRevision: next.revision,
        },
        {
          userId: fixture.userId,
          authorize: async (tx) => {
            if (firstAttempt) {
              firstAttempt = false;
              await tx.courseClass.findUniqueOrThrow({
                where: { id: cls.id },
                select: { id: true },
              });
              started.resolve();
              await release.promise;
            }
            return { userId: fixture.userId };
          },
        }
      ).then(
        () => null,
        (error: unknown) => error
      );
      await started.promise;
      const finalReceipt = randomUUID();
      try {
        await fixture.instance.database.courseClass.update({
          where: { id: cls.id },
          data: {
            prerequisiteGate: {
              ...gate,
              receiptId: finalReceipt,
              acknowledgment: { userId: fixture.userId, receiptId: finalReceipt, materialHash },
            },
          },
        });
      } finally {
        release.resolve();
      }
      expect(await stale).toBeInstanceOf(LearningProgressConflict);
      expect(
        (
          await fixture.instance.database.courseClass.findUniqueOrThrow({
            where: { id: cls.id },
          })
        ).progressRevision
      ).toBe(2);
      const protectedRevision = await revision();
      const currentClass = await fixture.instance.database.courseClass.findUniqueOrThrow({
        where: { id: cls.id },
        select: { lessonId: true },
      });
      await fixture.instance.database.courseClass.create({
        data: {
          courseId: fixture.courseId,
          lessonId: currentClass.lessonId,
          order: 0,
          status: 'PASSED',
          passedAt: new Date('2020-01-01T00:00:00Z'),
          createdAt: new Date('2020-01-01T00:00:00Z'),
          skillRequirements: fixture.requirements('CLASS', false, false),
        },
      });
      const unprotected = await revision();
      expect(unprotected.access).toBe('UNPROTECTED');
      expect(unprotected.revision).not.toBe(protectedRevision.revision);
      await expect(
        saveLearningProgress('CLASS', cls.id, fixture.userId, {
          ...changes,
          expectedRevision: 2,
        })
      ).rejects.toThrow('needs a current material revision');
      await expect(
        saveLearningProgress('CLASS', cls.id, fixture.userId, {
          ...changes,
          expectedRevision: 2,
          expectedAttempt: 1,
          taskMaterialRevision: protectedRevision.revision,
        })
      ).rejects.toThrow('class material changed');
      expect(
        await saveLearningProgress('CLASS', cls.id, fixture.userId, {
          ...changes,
          expectedRevision: 2,
          expectedAttempt: 1,
          taskMaterialRevision: unprotected.revision,
        })
      ).toBe(3);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  registerSubmissionCases({ fixture, saveLearningProgress, submitClass });
});
