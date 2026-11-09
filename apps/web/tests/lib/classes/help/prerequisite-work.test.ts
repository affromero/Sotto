// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@/generated/prisma/client';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { createSkillRequirements } from '@sotto/shared';
import { prepareStorageCleanup, StorageCleanupJournal } from 'thesidedoor-core/storage';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { prerequisiteDeletionCases } from './prerequisite-deletion-cases';
import {
  assertTamperedDirectionsAreHidden,
  prerequisiteSourceCases,
} from './prerequisite-source-cases';
import {
  readPrerequisiteSource,
  readCurrentPrerequisiteAddendum,
  rejectExactPrerequisiteAnswers,
} from '@/lib/classes/help/content/prerequisite-source';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';
import { sampleTeaching } from '../../../helpers/learning/class-teaching';
import { generatePrerequisiteAddendum } from '@/lib/classes/help/content/prerequisite-generation';
import {
  admitPrerequisiteWork,
  prerequisiteWorkSchema,
} from '@/lib/classes/help/lifecycle/prerequisite-admission';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import {
  readPrerequisiteWorkStatus,
  startPrerequisiteWork,
  failPrerequisiteWork,
} from '@/lib/classes/help/prerequisite-outcome';
import { processClassPrerequisite } from '@/workers/interactions/class-prerequisite.worker';
import { readPrerequisiteStatus } from '@/lib/classes/help/prerequisite-status';
import {
  erasePrerequisiteDeletion,
  inspectPrerequisiteDeletion,
} from '@/lib/classes/help/prerequisite-deletion';

const boundary = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  execution: null as SottoProviderExecution | null,
  schema: null as string | null,
  failCleanup: false,
}));
const provider = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async (...args: [string, unknown]) => {
    boundary.execution = args[1] as SottoProviderExecution;
    return { provider: 'fixture', model: 'fixture', execution: args[1] };
  },
  capturedLearningAiOptions: async () => ({ model: 'fixture' }),
}));
vi.mock('@/lib/providers/ai', async () => {
  const { prerequisiteDirectionFixture } =
    await import('../../../helpers/learning/prerequisite-provider');
  return {
    createAIProvider: () => ({
      generateResponse: (
        system: string,
        messages: Array<{ content: string }>,
        options?: { jsonSchema?: { name?: string } }
      ) =>
        prerequisiteDirectionFixture(messages, options) ??
        provider.generate(system, messages, options),
    }),
  };
});
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('@/lib/sidedoor/storage/core/storage-connection', async (original) => {
  const actual = await original<typeof import('@/lib/sidedoor/storage/core/storage-connection')>();
  return {
    ...actual,
    openSottoStorageConnection: (url?: string, schema?: string) =>
      actual.openSottoStorageConnection(url, schema ?? boundary.schema ?? undefined),
  };
});
vi.mock('@/lib/sidedoor/storage/migration/storage-cleanup-runtime', async (original) => {
  const actual =
    await original<typeof import('@/lib/sidedoor/storage/migration/storage-cleanup-runtime')>();
  return {
    ...actual,
    runSottoStorageCleanup: async (...args: Parameters<typeof actual.runSottoStorageCleanup>) => {
      if (boundary.failCleanup) {
        boundary.failCleanup = false;
        throw new Error('injected storage cleanup interruption');
      }
      return actual.runSottoStorageCleanup(...args);
    },
  };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('saved prerequisite durable work', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let classId: string;
  let questionId: string;
  let writingPromptId: string;

  beforeAll(async () => {
    instance = await createSharedTestInstance('prerequisite_source');
    boundary.database = instance.database;
    boundary.schema = instance.schema;
  });
  beforeEach(async () => {
    provider.generate.mockReset();
    boundary.execution = null;
    boundary.failCleanup = false;
    identity = await instance.reset();
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'ru' } },
      create: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
      update: {},
    });
    const lesson = await instance.database.lesson.create({
      data: {
        curriculumId: curriculum.id,
        slug: `first-${identity.ownerId}`,
        level: 'A1',
        order:
          (await instance.database.lesson.count({ where: { curriculumId: curriculum.id } })) + 1,
        title: 'First words',
        objective: 'Make a request',
        grammarPoints: [],
        targetVocab: [],
        vocabThemes: [],
      },
    });
    const course = await instance.database.course.create({
      data: {
        userId: identity.ownerId,
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
        status: 'IN_PROGRESS',
        learnerAnswers: { secret: 1 },
        writingDrafts: { private: 'PRIVATE_DRAFT' },
        skillRequirements: createSkillRequirements({
          scope: 'CLASS',
          nativeLang: 'es',
          targetLang: 'ru',
          level: 'A1',
          ttsProvider: null,
          sttProvider: null,
        }),
        adaptiveSeed: {
          teaching: {
            ...sampleTeaching,
            guidedPractice: {
              ...sampleTeaching.guidedPractice,
              answer: 'PRIVATE_GUIDED_ANSWER',
              explanation: 'PRIVATE_GUIDED_EXPLANATION',
            },
          },
        },
      },
    });
    classId = cls.id;
    const section = await instance.database.classSection.create({
      data: { classId, skill: 'GRAMMAR', attempt: 1, status: 'READY', seed: 'seed', spec: {} },
    });
    const question = await instance.database.lessonQuestion.create({
      data: {
        sectionId: section.id,
        order: 1,
        skill: 'GRAMMAR',
        question: 'Pide té con cortesía.',
        options: ['Чай, пожалуйста', 'Спасибо', 'Привет', 'До свидания'],
        correctIndex: 0,
        explanation: 'PRIVATE_ASSESSMENT_EXPLANATION',
      },
    });
    questionId = question.id;
    await instance.database.lessonQuestion.createMany({
      data: Array.from({ length: 4 }, (_, index) => ({
        sectionId: section.id,
        order: index + 2,
        skill: 'GRAMMAR' as const,
        question: `Pregunta ${index + 2}`,
        options: ['Uno', 'Dos', 'Tres', 'Cuatro'],
        correctIndex: 0,
        explanation: 'Explicación.',
      })),
    });
    const reading = await instance.database.classSection.create({
      data: { classId, skill: 'READING', attempt: 1, status: 'READY', seed: 'seed', spec: {} },
    });
    await instance.database.lessonQuestion.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        sectionId: reading.id,
        order: index + 1,
        skill: 'READING' as const,
        question: `Lectura ${index + 1}`,
        options: ['Uno', 'Dos', 'Tres', 'Cuatro'],
        correctIndex: 0,
        explanation: 'Explicación.',
        passageText: 'Un texto para leer.',
      })),
    });
    const writing = await instance.database.classSection.create({
      data: { classId, skill: 'WRITING', attempt: 1, status: 'READY', seed: 'seed', spec: {} },
    });
    const prompt = await instance.database.writingPrompt.create({
      data: {
        sectionId: writing.id,
        order: 1,
        task: 'Escribe una petición.',
        guidance: 'Usa cortesía.',
        ideas: ['PRIVATE_OPTIONAL_OPENING'],
      },
    });
    writingPromptId = prompt.id;
    await instance.database.writingPrompt.createMany({
      data: [
        { sectionId: writing.id, order: 2, task: 'Escribe otro saludo.' },
        { sectionId: writing.id, order: 3, task: 'Escribe un mensaje.' },
      ],
    });
  });
  afterAll(async () => {
    boundary.database = null;
    boundary.schema = null;
    await instance?.close();
  });

  it.each(['Elige B', 'La correcta es B', 'Choose B', 'Выберите B', 'Elige A'])(
    'rejects direct task option selection: %s',
    async (guidance) => {
      const captured = await sottoTransaction(instance.database, (database) =>
        readPrerequisiteSource(database, classId, identity.ownerId)
      );
      await expect(
        sottoTransaction(instance.database, (database) =>
          rejectExactPrerequisiteAnswers(database, captured, captured.ownership, [guidance])
        )
      ).rejects.toThrow('could not be prepared safely');
    }
  );

  it('does not mistake ordinary English and Spanish articles for an option label', async () => {
    const captured = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    await expect(
      sottoTransaction(instance.database, (database) =>
        rejectExactPrerequisiteAnswers(database, captured, captured.ownership, [
          'The answer is a complete sentence.',
          'Elige a tu compañero.',
        ])
      )
    ).resolves.toBeUndefined();
  });

  it('teaches a needed word even when it is a correct formative option', async () => {
    await instance.database.lessonQuestion.update({
      where: { id: questionId },
      data: { options: ['чай', 'вода', 'молоко', 'сок'], correctIndex: 0 },
    });
    provider.generate
      .mockResolvedValueOnce({
        content: JSON.stringify({
          title: 'Pedir',
          explanation: '«Чай» significa té.',
          examples: [{ target: 'Вода', meaning: 'Agua', explanation: 'Un ejemplo.' }],
        }),
        model: 'fixture',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          prerequisitesCovered: true,
          accurate: true,
          understandable: true,
          answersConcealed: true,
          issues: [],
        }),
        model: 'fixture',
      });
    const captured = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    await expect(
      generatePrerequisiteAddendum(captured, {
        userId: identity.ownerId,
        authorize: async () => ({ userId: identity.ownerId }),
      })
    ).resolves.toMatchObject({ explanation: '«Чай» significa té.' });
  });

  it('withholds a candidate when the reviewer flags the reported untranslated task directions', async () => {
    const reported =
      'Преврати сообщение после приветствия в вопрос о собеседнике: сохрани лицо и настоящее время (sin añadir «ser»).\nПривет! Ты Павел.';
    await instance.database.lessonQuestion.update({
      where: { id: questionId },
      data: { question: reported },
    });
    provider.generate
      .mockResolvedValueOnce({
        content: JSON.stringify({
          title: 'Pedir',
          explanation: 'Usa una fórmula de cortesía.',
          examples: [{ target: 'Вода', meaning: 'Agua', explanation: 'Un ejemplo.' }],
        }),
        model: 'fixture',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          prerequisitesCovered: false,
          accurate: true,
          understandable: false,
          answersConcealed: true,
          issues: ['Task directions are not explained.'],
        }),
        model: 'fixture',
      });
    const captured = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    await expect(
      generatePrerequisiteAddendum(captured, {
        userId: identity.ownerId,
        authorize: async () => ({ userId: identity.ownerId }),
      })
    ).rejects.toThrow('did not pass independent review');
    expect(provider.generate.mock.calls[0][0]).toContain(
      'directions are prepared and reviewed separately'
    );
    expect(provider.generate.mock.calls[1][0]).toContain(
      'directions are prepared and reviewed separately'
    );
    expect(provider.generate.mock.calls[1][0]).toContain('Do not call that an answer reveal');
    for (const call of provider.generate.mock.calls) {
      expect(JSON.stringify(call[1])).toContain('Преврати сообщение');
      expect(JSON.stringify(call[1])).not.toMatch(/PRIVATE_|correctIndex/);
    }
    expect(
      await sottoTransaction(instance.database, (database) =>
        readCurrentPrerequisiteAddendum(database, classId, identity.ownerId)
      )
    ).toEqual({ status: 'UNAVAILABLE' });
  });

  it('admits one durable request when matching requests race', async () => {
    const request = () => ({
      id: randomUUID(),
      revision: randomUUID(),
      classId,
      userId: identity.ownerId,
      expiresAt: Date.now() + 60_000,
      selection: {
        provider: 'fixture',
        model: 'fixture',
        credentialFingerprint: null,
        moderationCredentialFingerprint: null,
      },
      authorize: async () => ({ userId: identity.ownerId }),
    });
    const [first, second] = await Promise.all([
      sottoTransaction(instance.database, (database) => admitPrerequisiteWork(database, request())),
      sottoTransaction(instance.database, (database) => admitPrerequisiteWork(database, request())),
    ]);
    expect(second.job.id).toBe(first.job.id);
    expect(second.fingerprint).toBe(first.fingerprint);
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    expect(first.job.scopes).toContainEqual({
      subjectId: `class:${classId}`,
      generation: cls.createdAt.getTime(),
    });
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(first.job.id)
      )
    ).toMatchObject({ complete: false, job: { handler: 'interactions', version: 5 } });
  });

  prerequisiteDeletionCases(() => ({
    instance,
    identity,
    classId,
    interruptCleanup: () => {
      boundary.failCleanup = true;
    },
  }));
  prerequisiteSourceCases(() => ({ instance, identity, classId, questionId, writingPromptId }));

  it('refuses a class whose storage generation has a deletion tombstone', async () => {
    const record = await sottoTransaction(instance.database, (database) =>
      admitPrerequisiteWork(database, {
        id: randomUUID(),
        revision: randomUUID(),
        classId,
        userId: identity.ownerId,
        expiresAt: Date.now() + 60_000,
        selection: {
          provider: 'fixture',
          model: 'fixture',
          credentialFingerprint: null,
          moderationCredentialFingerprint: null,
        },
        authorize: async () => ({ userId: identity.ownerId }),
      })
    );
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      await new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID).createJob(
        prepareStorageCleanup({
          namespace: SIDEDOOR_STATE_ID,
          subjectId: `class:${classId}`,
          generation: cls.createdAt.getTime(),
          retentionPolicy: 'job-id-snapshots-v1',
        })
      );
    });
    await expect(
      sottoTransaction(instance.database, (database) =>
        readPrerequisiteSource(database, classId, identity.ownerId)
      )
    ).rejects.toThrow('Course storage ownership changed');
    await expect(
      sottoTransaction(instance.database, (database) =>
        startPrerequisiteWork(database, {
          id: record.job.id,
          fingerprint: record.fingerprint,
        })
      )
    ).rejects.toThrow('Course storage ownership changed');
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(record.job.id)
      )
    ).toMatchObject({ complete: false });
  });

  it('blocks another request after the saved lesson changes while work is active', async () => {
    const request = () => ({
      id: randomUUID(),
      revision: randomUUID(),
      classId,
      userId: identity.ownerId,
      expiresAt: Date.now() + 60_000,
      selection: {
        provider: 'fixture',
        model: 'fixture',
        credentialFingerprint: null,
        moderationCredentialFingerprint: null,
      },
      authorize: async () => ({ userId: identity.ownerId }),
    });
    const first = await sottoTransaction(instance.database, (database) =>
      admitPrerequisiteWork(database, request())
    );
    await instance.database.lessonQuestion.update({
      where: { id: questionId },
      data: { question: 'Una pregunta modificada.' },
    });
    await expect(
      sottoTransaction(instance.database, (database) => admitPrerequisiteWork(database, request()))
    ).rejects.toThrow('already active or needs recovery');
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(first.job.id)
      )
    ).toMatchObject({ complete: false });
  });

  it('retains an uncertain outcome even after the lesson changes', async () => {
    const request = () => ({
      id: randomUUID(),
      revision: randomUUID(),
      classId,
      userId: identity.ownerId,
      expiresAt: Date.now() + 60_000,
      selection: {
        provider: 'fixture',
        model: 'fixture',
        credentialFingerprint: null,
        moderationCredentialFingerprint: null,
      },
      authorize: async () => ({ userId: identity.ownerId }),
    });
    const record = await sottoTransaction(instance.database, (database) =>
      admitPrerequisiteWork(database, request())
    );
    const operation = { id: record.job.id, fingerprint: record.fingerprint };
    const { fence } = prerequisiteWorkSchema.parse(record.job.payload);
    await sottoTransaction(instance.database, (database) =>
      startPrerequisiteWork(database, operation)
    );
    await instance.database.lessonQuestion.update({
      where: { id: questionId },
      data: { question: 'Una pregunta modificada.' },
    });
    expect(
      await sottoTransaction(instance.database, (database) =>
        failPrerequisiteWork(database, operation, true, 'UNSAFE')
      )
    ).toBe('UNRESOLVED');
    const authority = await sottoTransaction(instance.database, (database) =>
      learningPreparationGrant(database, fence, 'prerequisite').read(fence.grant)
    );
    expect(authority.status).toBe('revoked');
    expect(authority.attempts).toMatchObject([{ outcome: 'unknown' }]);
    await expect(
      sottoTransaction(instance.database, (database) =>
        inspectPrerequisiteDeletion(database, classId, fence.courseId, identity.ownerId)
      )
    ).rejects.toThrow('active or requires recovery');
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(operation.id)
      )
    ).toMatchObject({ complete: false });
    await expect(
      sottoTransaction(instance.database, (database) => admitPrerequisiteWork(database, request()))
    ).rejects.toThrow('already active or needs recovery');
  });

  it('does not reuse an operation after its provider grant is revoked', async () => {
    const request = () => ({
      id: randomUUID(),
      revision: randomUUID(),
      classId,
      userId: identity.ownerId,
      expiresAt: Date.now() + 60_000,
      selection: {
        provider: 'fixture',
        model: 'fixture',
        credentialFingerprint: null,
        moderationCredentialFingerprint: null,
      },
      authorize: async () => ({ userId: identity.ownerId }),
    });
    const first = await sottoTransaction(instance.database, (database) =>
      admitPrerequisiteWork(database, request())
    );
    const { fence } = prerequisiteWorkSchema.parse(first.job.payload);
    await sottoTransaction(instance.database, (database) =>
      learningPreparationGrant(database, fence, 'prerequisite').revoke(fence.grant)
    );
    await expect(
      sottoTransaction(instance.database, (database) => admitPrerequisiteWork(database, request()))
    ).rejects.toMatchObject({ code: 'closed' });
  });

  it('keeps an admitted provider attempt unresolved even when cleanup is reported complete', async () => {
    const record = await sottoTransaction(instance.database, (database) =>
      admitPrerequisiteWork(database, {
        id: randomUUID(),
        revision: randomUUID(),
        classId,
        userId: identity.ownerId,
        expiresAt: Date.now() + 60_000,
        selection: {
          provider: 'fixture',
          model: 'fixture',
          credentialFingerprint: null,
          moderationCredentialFingerprint: null,
        },
        authorize: async () => ({ userId: identity.ownerId }),
      })
    );
    const operation = { id: record.job.id, fingerprint: record.fingerprint };
    const { fence } = prerequisiteWorkSchema.parse(record.job.payload);
    await sottoTransaction(instance.database, (database) =>
      startPrerequisiteWork(database, operation)
    );
    await sottoTransaction(instance.database, (database) =>
      learningPreparationGrant(database, fence, 'prerequisite').admit(fence.grant, {
        id: randomUUID(),
        fingerprint: 'a'.repeat(64),
      })
    );
    expect(
      await sottoTransaction(instance.database, (database) =>
        failPrerequisiteWork(database, operation, false)
      )
    ).toBe('UNRESOLVED');
  });

  it('records a confirmed failure after the operation drains', async () => {
    const record = await sottoTransaction(instance.database, (database) =>
      admitPrerequisiteWork(database, {
        id: randomUUID(),
        revision: randomUUID(),
        classId,
        userId: identity.ownerId,
        expiresAt: Date.now() + 60_000,
        selection: {
          provider: 'fixture',
          model: 'fixture',
          credentialFingerprint: null,
          moderationCredentialFingerprint: null,
        },
        authorize: async () => ({ userId: identity.ownerId }),
      })
    );
    const operation = { id: record.job.id, fingerprint: record.fingerprint };
    const { fence } = prerequisiteWorkSchema.parse(record.job.payload);
    await sottoTransaction(instance.database, (database) =>
      startPrerequisiteWork(database, operation)
    );
    expect(
      await sottoTransaction(instance.database, (database) =>
        failPrerequisiteWork(database, operation, false)
      )
    ).toBe('FAILED');
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(operation.id)
      )
    ).toMatchObject({ complete: true });
    const authority = await sottoTransaction(instance.database, (database) =>
      learningPreparationGrant(database, fence, 'prerequisite').read(fence.grant)
    );
    expect(authority.status).toBe('revoked');
    expect(authority.attempts).toMatchObject([{ outcome: 'failed' }]);
    await expect(
      sottoTransaction(instance.database, async (database) => {
        const inventory = await inspectPrerequisiteDeletion(
          database,
          classId,
          fence.courseId,
          identity.ownerId
        );
        expect(inventory.operations).toEqual([
          { id: record.job.id, fingerprint: record.fingerprint },
        ]);
        const executor = {
          query: (sql: string, values: readonly unknown[]) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        };
        await new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID).createJob(
          prepareStorageCleanup({
            namespace: SIDEDOOR_STATE_ID,
            ...inventory.classScope,
            retentionPolicy: 'job-id-snapshots-v1',
          })
        );
        await erasePrerequisiteDeletion(database, inventory);
        throw new Error('rollback deletion');
      })
    ).rejects.toThrow('rollback deletion');
    expect(
      await sottoTransaction(instance.database, (database) =>
        inspectPrerequisiteDeletion(database, classId, fence.courseId, identity.ownerId)
      )
    ).toMatchObject({ operations: [{ id: record.job.id, fingerprint: record.fingerprint }] });
    const retry = await sottoTransaction(instance.database, (database) =>
      admitPrerequisiteWork(database, {
        id: randomUUID(),
        revision: randomUUID(),
        classId,
        userId: identity.ownerId,
        expiresAt: Date.now() + 60_000,
        selection: {
          provider: 'fixture',
          model: 'fixture',
          credentialFingerprint: null,
          moderationCredentialFingerprint: null,
        },
        authorize: async () => ({ userId: identity.ownerId }),
      })
    );
    expect(retry.job.id).not.toBe(record.job.id);
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(record.job.id)
      )
    ).toMatchObject({ complete: true });
  });

  it('runs the durable worker, publishes once and acknowledges the saved result', async () => {
    provider.generate
      .mockResolvedValueOnce({
        content: JSON.stringify({
          title: 'Pedir',
          explanation: 'Nombra el objeto.',
          examples: [{ target: 'Вода', meaning: 'Agua', explanation: 'Un ejemplo.' }],
        }),
        model: 'fixture',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          prerequisitesCovered: true,
          accurate: true,
          understandable: true,
          answersConcealed: true,
          issues: [],
        }),
        model: 'fixture',
      });
    const record = await sottoTransaction(instance.database, (database) =>
      admitPrerequisiteWork(database, {
        id: randomUUID(),
        revision: randomUUID(),
        classId,
        userId: identity.ownerId,
        expiresAt: Date.now() + 60_000,
        selection: {
          provider: 'fixture',
          model: 'fixture',
          credentialFingerprint: null,
          moderationCredentialFingerprint: null,
        },
        authorize: async () => ({ userId: identity.ownerId }),
      })
    );
    const job = {
      id: record.job.id,
      name: 'interactions.v5',
      data: { operationId: record.job.id, fingerprint: record.fingerprint },
      updateProgress: async () => undefined,
    } as unknown as Job<unknown>;
    const directory = await mkdtemp(join(tmpdir(), 'sotto-prerequisite-worker-'));
    const previous = process.env.SIDEDOOR_EXECUTION_DIR;
    process.env.SIDEDOOR_EXECUTION_DIR = join(directory, 'executions');
    try {
      const { processInteraction } = await import('@/workers/interaction.worker');
      await processInteraction(job as Job<import('@/lib/queue').ProcessInteractionPayload>);
      await processClassPrerequisite(job);
      expect(provider.generate).toHaveBeenCalledTimes(2);
      expect(
        await sottoTransaction(instance.database, (database) =>
          sottoJobOutbox(database).read(record.job.id)
        )
      ).toMatchObject({ complete: true });
      expect(
        await sottoTransaction(instance.database, (database) =>
          readCurrentPrerequisiteAddendum(database, classId, identity.ownerId)
        )
      ).toMatchObject({ status: 'READY', content: { title: 'Pedir' } });
      const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
      expect(cls.learnerAnswers).toEqual({ secret: 1 });
      expect(cls.writingDrafts).toEqual({ private: 'PRIVATE_DRAFT' });
      expect(
        await sottoTransaction(instance.database, (database) =>
          readPrerequisiteStatus(database, classId, identity.ownerId)
        )
      ).toMatchObject({ status: 'READY', content: { title: 'Pedir' } });
      await assertTamperedDirectionsAreHidden(instance, identity, classId);
      await instance.database.lessonQuestion.update({
        where: { id: questionId },
        data: { question: 'Una pregunta nueva.' },
      });
      expect(
        await sottoTransaction(instance.database, (database) =>
          readPrerequisiteStatus(database, classId, identity.ownerId)
        )
      ).toMatchObject({ status: 'STALE', canRetry: true });
    } finally {
      if (previous === undefined) delete process.env.SIDEDOOR_EXECUTION_DIR;
      else process.env.SIDEDOOR_EXECUTION_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('settles a worker failure when the lesson changes during generation', async () => {
    provider.generate
      .mockImplementationOnce(async () => {
        await instance.database.lessonQuestion.update({
          where: { id: questionId },
          data: { question: 'Una pregunta modificada.' },
        });
        return {
          content: JSON.stringify({
            title: 'Pedir',
            explanation: 'Nombra el objeto.',
            examples: [{ target: 'Вода', meaning: 'Agua', explanation: 'Un ejemplo.' }],
          }),
          model: 'fixture',
        };
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          prerequisitesCovered: true,
          accurate: true,
          understandable: true,
          answersConcealed: true,
          issues: [],
        }),
        model: 'fixture',
      });
    const record = await sottoTransaction(instance.database, (database) =>
      admitPrerequisiteWork(database, {
        id: randomUUID(),
        revision: randomUUID(),
        classId,
        userId: identity.ownerId,
        expiresAt: Date.now() + 60_000,
        selection: {
          provider: 'fixture',
          model: 'fixture',
          credentialFingerprint: null,
          moderationCredentialFingerprint: null,
        },
        authorize: async () => ({ userId: identity.ownerId }),
      })
    );
    const { fence } = prerequisiteWorkSchema.parse(record.job.payload);
    const job = {
      id: record.job.id,
      name: 'interactions.v5',
      data: { operationId: record.job.id, fingerprint: record.fingerprint },
      updateProgress: async () => undefined,
    } as unknown as Job<unknown>;
    const directory = await mkdtemp(join(tmpdir(), 'sotto-prerequisite-worker-'));
    const previous = process.env.SIDEDOOR_EXECUTION_DIR;
    process.env.SIDEDOOR_EXECUTION_DIR = join(directory, 'executions');
    try {
      await expect(processClassPrerequisite(job)).rejects.toThrow(
        'Prerequisite teaching could not be prepared.'
      );
      expect(
        await sottoTransaction(instance.database, (database) =>
          sottoJobOutbox(database).read(record.job.id)
        )
      ).toMatchObject({ complete: true });
      expect(
        await sottoTransaction(instance.database, (database) =>
          learningPreparationGrant(database, fence, 'prerequisite').read(fence.grant)
        )
      ).toMatchObject({ status: 'revoked', attempts: [{ outcome: 'failed' }] });
      expect(
        await sottoTransaction(instance.database, (database) =>
          readCurrentPrerequisiteAddendum(database, classId, identity.ownerId)
        )
      ).toEqual({ status: 'UNAVAILABLE' });
    } finally {
      if (previous === undefined) delete process.env.SIDEDOOR_EXECUTION_DIR;
      else process.env.SIDEDOOR_EXECUTION_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fences the worker after a provider connection is lost during dispatch', async () => {
    provider.generate.mockImplementationOnce(async () => {
      const request = boundary.execution?.providerRequest;
      if (!request) throw new Error('Provider admission is missing');
      await request(
        new Request('https://provider.example/test', { method: 'POST', body: 'fixture' }),
        async () => {
          throw new Error('Connection lost after dispatch');
        }
      );
      throw new Error('Unexpected provider response');
    });
    const record = await sottoTransaction(instance.database, (database) =>
      admitPrerequisiteWork(database, {
        id: randomUUID(),
        revision: randomUUID(),
        classId,
        userId: identity.ownerId,
        expiresAt: Date.now() + 60_000,
        selection: {
          provider: 'fixture',
          model: 'fixture',
          credentialFingerprint: null,
          moderationCredentialFingerprint: null,
        },
        authorize: async () => ({ userId: identity.ownerId }),
      })
    );
    const { fence } = prerequisiteWorkSchema.parse(record.job.payload);
    const operation = { id: record.job.id, fingerprint: record.fingerprint };
    const job = {
      id: record.job.id,
      name: 'interactions.v5',
      data: { operationId: record.job.id, fingerprint: record.fingerprint },
      updateProgress: async () => undefined,
    } as unknown as Job<unknown>;
    const directory = await mkdtemp(join(tmpdir(), 'sotto-prerequisite-worker-'));
    const previous = process.env.SIDEDOOR_EXECUTION_DIR;
    process.env.SIDEDOOR_EXECUTION_DIR = join(directory, 'executions');
    try {
      await expect(processClassPrerequisite(job)).rejects.toThrow();
      expect(
        await sottoTransaction(instance.database, (database) =>
          readPrerequisiteWorkStatus(database, operation)
        )
      ).toBe('UNRESOLVED');
      const authority = await sottoTransaction(instance.database, (database) =>
        learningPreparationGrant(database, fence, 'prerequisite').read(fence.grant)
      );
      expect(authority.status).toBe('revoked');
      expect(authority.attempts.map((attempt) => attempt.outcome)).toEqual(['unknown', 'unknown']);
      expect(
        await sottoTransaction(instance.database, (database) =>
          sottoJobOutbox(database).read(record.job.id)
        )
      ).toMatchObject({ complete: false });
      await expect(processClassPrerequisite(job)).rejects.toThrow();
      expect(provider.generate).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) delete process.env.SIDEDOOR_EXECUTION_DIR;
      else process.env.SIDEDOOR_EXECUTION_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('binds the requested provider selection before authorization awaits', async () => {
    const selection = {
      provider: 'fixture',
      model: 'original',
      credentialFingerprint: null,
      moderationCredentialFingerprint: null,
    };
    const result = await sottoTransaction(instance.database, (database) =>
      admitPrerequisiteWork(database, {
        id: randomUUID(),
        revision: randomUUID(),
        classId,
        userId: identity.ownerId,
        expiresAt: Date.now() + 60_000,
        selection,
        authorize: async () => {
          selection.model = 'changed';
          return { userId: identity.ownerId };
        },
      })
    );
    expect(prerequisiteWorkSchema.parse(result.job.payload).fence.selection.model).toBe('original');
  });

  it('rolls back admission when the provider grant has expired', async () => {
    const request = {
      id: randomUUID(),
      revision: randomUUID(),
      classId,
      userId: identity.ownerId,
      expiresAt: Date.now() - 1,
      selection: {
        provider: 'fixture',
        model: 'fixture',
        credentialFingerprint: null,
        moderationCredentialFingerprint: null,
      },
      authorize: async () => ({ userId: identity.ownerId }),
    };
    await expect(
      sottoTransaction(instance.database, (database) => admitPrerequisiteWork(database, request))
    ).rejects.toMatchObject({ code: 'expired' });
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(request.id)
      )
    ).toBeNull();
    const admitted = await sottoTransaction(instance.database, (database) =>
      admitPrerequisiteWork(database, { ...request, expiresAt: Date.now() + 60_000 })
    );
    expect(admitted.job.id).toBe(request.id);
  });
});
