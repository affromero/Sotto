// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { learningScriptHash } from '@/lib/learning/script-hash';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  generateScript: vi.fn(),
}));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async (_userId: string, execution: unknown) => ({
    provider: 'openai',
    model: 'fixture',
    execution,
  }),
  capturedLearningAiOptions: async () => ({}),
}));
vi.mock('@/lib/server-config', () => ({ getServerInfra: async () => ({}) }));
vi.mock('@/lib/auto-model-config', () => ({ getAutoModelConfig: async () => ({ model: {} }) }));
vi.mock('@/lib/script-generator', async (original) => ({
  ...(await original<typeof import('@/lib/script-generator')>()),
  generateScript: (...args: unknown[]) => boundary.generateScript(...args),
}));
vi.mock('@/lib/segment-creator', () => ({
  createSegmentsAndQueueAudio: async (
    _episodeId: string,
    _turns: unknown,
    options: { authorize: (database: unknown) => Promise<unknown> }
  ) => boundary.database!.$transaction((database) => options.authorize(database)),
}));

import { composeListeningContent, queueListeningAudio } from '@/lib/class-listening-generator';

describe.skipIf(!process.env.SIDEDOOR_TEST_DATABASE_URL)('listening episode admission', () => {
  let instance: SharedTestInstance;
  let userId: string;
  let courseId: string;
  let classId: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('listening_admission');
    boundary.database = instance.database;
  });
  afterAll(async () => {
    await instance?.close();
  });
  beforeEach(async () => {
    userId = (await instance.reset()).ownerId;
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'ru' } },
      create: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
      update: {},
    });
    const lesson = await instance.database.lesson.create({
      data: {
        curriculumId: curriculum.id,
        slug: randomUUID(),
        level: 'A1',
        order:
          (await instance.database.lesson.count({ where: { curriculumId: curriculum.id } })) + 1,
        title: 'First',
        objective: 'Greet',
        grammarPoints: [],
        targetVocab: [],
        vocabThemes: [],
      },
    });
    courseId = (
      await instance.database.course.create({
        data: { userId, curriculumId: curriculum.id, nativeLang: 'es', targetLang: 'ru' },
      })
    ).id;
    classId = (
      await instance.database.courseClass.create({
        data: { courseId, lessonId: lesson.id, order: 1, status: 'GENERATING', attempt: 2 },
      })
    ).id;
  });

  const params = () => ({
    userId,
    courseId,
    level: 'A1',
    nativeLang: 'es',
    targetLang: 'ru',
    objective: 'Greet',
    mustIncludeVocab: [],
    ttsProvider: null,
    deferAudio: true,
  });

  it('rolls back an inserted episode if authority is cancelled before commit', async () => {
    const controller = new AbortController();
    await expect(
      composeListeningContent({
        ...params(),
        execution: {
          userId,
          signal: controller.signal,
          authorize: async () => {
            controller.abort(new Error('Cancelled during admission'));
            return { userId };
          },
        },
      })
    ).rejects.toThrow('Cancelled during admission');
    expect(await instance.database.episode.count({ where: { userId } })).toBe(0);
  });

  it('does not create an episode for an obsolete class attempt', async () => {
    await expect(
      composeListeningContent({
        ...params(),
        firstSeenClassId: classId,
        generationClass: { classId, attempt: 1 },
        execution: { userId, authorize: async () => ({ userId }) },
      })
    ).rejects.toThrow('cancelled');
    expect(await instance.database.episode.count({ where: { userId } })).toBe(0);
  });

  it('does not create an episode for a course owned by another learner', async () => {
    const other = await instance.database.user.create({
      data: { email: `${randomUUID()}@example.test` },
    });
    const foreignCourse = await instance.database.course.create({
      data: {
        userId: other.id,
        curriculumId: (
          await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })
        ).curriculumId,
        nativeLang: 'es',
        targetLang: 'ru',
      },
    });
    await expect(
      composeListeningContent({
        ...params(),
        courseId: foreignCourse.id,
        execution: { userId, authorize: async () => ({ userId }) },
      })
    ).rejects.toThrow('Listening course is unavailable');
    expect(await instance.database.episode.count({ where: { userId } })).toBe(0);
  });

  it('does not attach a class generation to a different owned course', async () => {
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'de' } },
      create: { nativeLang: 'es', targetLang: 'de', title: 'German' },
      update: {},
    });
    const otherCourse = await instance.database.course.create({
      data: { userId, curriculumId: curriculum.id, nativeLang: 'es', targetLang: 'de' },
    });
    await expect(
      composeListeningContent({
        ...params(),
        courseId: otherCourse.id,
        firstSeenClassId: classId,
        generationClass: { classId, attempt: 2 },
        execution: { userId, authorize: async () => ({ userId }) },
      })
    ).rejects.toThrow('Listening class changed');
    expect(await instance.database.episode.count({ where: { userId } })).toBe(0);
  });

  it('does not overwrite an episode that was queued before a provider failure', async () => {
    boundary.generateScript.mockImplementationOnce(async () => {
      const episode = await instance.database.episode.findFirstOrThrow({ where: { userId } });
      await instance.database.episode.update({
        where: { id: episode.id },
        data: { audioGenerationKey: 'claimed-audio' },
      });
      throw new Error('Provider failed');
    });
    await expect(
      composeListeningContent({
        ...params(),
        execution: { userId, authorize: async () => ({ userId }) },
      })
    ).rejects.toThrow('Provider failed');
    expect(await instance.database.episode.findFirstOrThrow({ where: { userId } })).toMatchObject({
      status: 'PENDING',
      audioGenerationKey: 'claimed-audio',
    });
  });

  it('leaves listening unresolved when the attachment fence is unavailable', async () => {
    await instance.database
      .$executeRaw`ALTER TABLE "PracticeSession" DISABLE TRIGGER "PracticeSession_listening_attachment_fence"`;
    try {
      const cleanupErrors: unknown[] = [];
      boundary.generateScript.mockRejectedValueOnce(new Error('Provider failed'));
      await expect(
        composeListeningContent({
          ...params(),
          execution: {
            userId,
            authorize: async () => ({ userId }),
            onCleanupError: (error) => cleanupErrors.push(error),
          },
        })
      ).rejects.toThrow('Provider failed');
      expect(cleanupErrors).toHaveLength(1);
      expect((cleanupErrors[0] as Error).message).toContain(
        'Listening attachment fence is unavailable'
      );
      expect(await instance.database.episode.findFirstOrThrow({ where: { userId } })).toMatchObject(
        {
          status: 'PENDING',
        }
      );
    } finally {
      await instance.database
        .$executeRaw`ALTER TABLE "PracticeSession" ENABLE ALWAYS TRIGGER "PracticeSession_listening_attachment_fence"`;
    }
  });

  it('waits for a concurrent class attachment before retiring failed listening', async () => {
    let ready!: (value: { pid: number; episodeId: string }) => void;
    let fail!: (error: unknown) => void;
    let release!: () => void;
    const attached = new Promise<{ pid: number; episodeId: string }>((resolve, reject) => {
      ready = resolve;
      fail = reject;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writer: Promise<unknown> | undefined;
    boundary.generateScript.mockImplementationOnce(async () => {
      const episode = await instance.database.episode.findFirstOrThrow({ where: { userId } });
      writer = instance.database.$transaction(async (database) => {
        const [backend] = await database.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pg_backend_pid() AS pid`;
        await database.classSection.create({
          data: {
            classId,
            skill: 'LISTENING',
            attempt: 2,
            seed: 'concurrent',
            spec: {},
            episodeId: episode.id,
          },
        });
        ready({ pid: backend!.pid, episodeId: episode.id });
        await hold;
      });
      void writer.catch(fail);
      await attached;
      throw new Error('Provider failed after attachment');
    });
    const cleanupErrors: unknown[] = [];
    const generation = composeListeningContent({
      ...params(),
      execution: {
        userId,
        authorize: async () => ({ userId }),
        onCleanupError: (error) => cleanupErrors.push(error),
      },
    }).then(
      () => null,
      (error: unknown) => error
    );
    const { pid, episodeId } = await attached;
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const [state] = await instance.database.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND ${pid} = ANY(pg_blocking_pids(pid))
              AND query LIKE '%Episode%FOR UPDATE%') AS waiting
        `;
        if (state?.waiting) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
    } finally {
      release();
      await writer;
    }
    await expect(generation).resolves.toMatchObject({
      message: 'Provider failed after attachment',
    });
    expect(cleanupErrors).toEqual([]);
    expect(
      await instance.database.episode.findUniqueOrThrow({ where: { id: episodeId } })
    ).toMatchObject({
      status: 'PENDING',
    });
    expect(await instance.database.classSection.findFirst({ where: { episodeId } })).not.toBeNull();
  });

  it('does not attach a failed listening episode to a new class section', async () => {
    boundary.generateScript.mockRejectedValueOnce(new Error('Provider failed'));
    await expect(
      composeListeningContent({
        ...params(),
        execution: { userId, authorize: async () => ({ userId }) },
      })
    ).rejects.toThrow('Provider failed');
    const episode = await instance.database.episode.findFirstOrThrow({ where: { userId } });
    expect(episode.status).toBe('FAILED');
    await expect(
      instance.database.classSection.create({
        data: {
          classId,
          skill: 'LISTENING',
          attempt: 2,
          seed: 'late',
          spec: {},
          episodeId: episode.id,
        },
      })
    ).rejects.toThrow('Cannot attach an unavailable listening episode');
    await expect(
      instance.database.practiceSession.create({
        data: { courseId, kind: 'LISTENING', items: [], seed: 'late', episodeId: episode.id },
      })
    ).rejects.toThrow('Cannot attach an unavailable listening episode');
    const exam = await instance.database.mockExam.create({
      data: { userId, courseId, institution: 'CEFR_GENERIC', level: 'A1', blueprintId: 'fixture' },
    });
    await expect(
      instance.database.examSection.create({
        data: {
          examId: exam.id,
          skill: 'LISTENING',
          part: 'one',
          order: 1,
          format: 'listening',
          episodeId: episode.id,
        },
      })
    ).rejects.toThrow('Cannot attach an unavailable listening episode');
  });

  it.each(['RESEARCHING', 'SCRIPTING', 'COMPILING'] as const)(
    'does not attach a learning section while the episode is %s',
    async (status) => {
      const episode = await instance.database.episode.create({
        data: { userId, title: 'Listening', topic: 'Greet', source: 'CLASS', status },
      });
      await expect(
        instance.database.classSection.create({
          data: {
            classId,
            skill: 'LISTENING',
            attempt: 2,
            seed: 'late',
            spec: {},
            episodeId: episode.id,
          },
        })
      ).rejects.toThrow('Cannot attach an unavailable listening episode');
    }
  );

  it('admits audio only for an owned ready episode with the same saved script', async () => {
    const turns = [{ speaker: 'A', text: 'Привет' }];
    const episode = await instance.database.episode.create({
      data: {
        userId,
        title: 'Listening',
        topic: 'Greet',
        source: 'CLASS',
        status: 'FAILED',
        script: { create: { turns, markdown: 'Привет' } },
      },
    });
    const execution = { userId, authorize: async () => ({ userId }) };
    const content = { episodeId: episode.id, turns, comprehensionQuestions: [] };
    const session = await instance.database.practiceSession.create({
      data: { courseId, kind: 'LISTENING', items: [], seed: 'fixture' },
    });
    const parent = { practiceSessionId: session.id };
    await expect(queueListeningAudio(content, execution, parent)).rejects.toThrow(
      'Listening audio source changed'
    );
    await instance.database.episode.update({
      where: { id: episode.id },
      data: { status: 'SCRIPT_READY' },
    });
    await expect(
      queueListeningAudio(
        { ...content, turns: [{ speaker: 'A', text: 'Different' }] },
        execution,
        parent
      )
    ).rejects.toThrow('Listening audio source changed');
    await expect(queueListeningAudio(content, execution, parent)).rejects.toThrow(
      'Listening audio source changed'
    );
    await instance.database.practiceSession.update({
      where: { id: session.id },
      data: { episodeId: episode.id, listeningScriptHash: learningScriptHash(turns) },
    });
    await expect(queueListeningAudio(content, execution, parent)).resolves.toBeUndefined();
  });

  it('does not queue an episode attached to a different class owned by the same learner', async () => {
    const original = await instance.database.courseClass.findUniqueOrThrow({
      where: { id: classId },
    });
    const other = await instance.database.courseClass.create({
      data: { courseId, lessonId: original.lessonId, order: 2, status: 'GENERATING', attempt: 2 },
    });
    const turns = [{ speaker: 'A', text: 'Привет' }];
    const episode = await instance.database.episode.create({
      data: {
        userId,
        title: 'Listening',
        topic: 'Greet',
        source: 'CLASS',
        status: 'SCRIPT_READY',
        script: { create: { turns, markdown: 'Привет' } },
      },
    });
    await instance.database.classSection.create({
      data: {
        classId: other.id,
        skill: 'LISTENING',
        attempt: 2,
        status: 'READY',
        seed: 'fixture',
        spec: {},
        episodeId: episode.id,
      },
    });
    const content = { episodeId: episode.id, turns, comprehensionQuestions: [] };
    await expect(
      queueListeningAudio(
        content,
        { userId, authorize: async () => ({ userId }) },
        { classId, attempt: 2 }
      )
    ).rejects.toThrow('Listening audio source changed');
  });

  it('rejects an attachment that waits for a concurrent failure to commit', async () => {
    const episode = await instance.database.episode.create({
      data: { userId, title: 'Listening', topic: 'Greet', source: 'CLASS', status: 'PENDING' },
    });
    let ready!: (pid: number) => void;
    let failed!: (error: unknown) => void;
    let release!: () => void;
    const locked = new Promise<number>((resolve, reject) => {
      ready = resolve;
      failed = reject;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cleanup = instance.database.$transaction(async (database) => {
      const [backend] = await database.$queryRaw<
        Array<{ pid: number }>
      >`SELECT pg_backend_pid() AS pid`;
      await database.episode.update({ where: { id: episode.id }, data: { status: 'FAILED' } });
      ready(backend!.pid);
      await hold;
    });
    void cleanup.catch(failed);
    const pid = await locked;
    const attachment = instance.database.classSection
      .create({
        data: {
          classId,
          skill: 'LISTENING',
          attempt: 2,
          seed: 'late',
          spec: {},
          episodeId: episode.id,
        },
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const [state] = await instance.database.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND ${pid} = ANY(pg_blocking_pids(pid))) AS waiting
        `;
        if (state?.waiting) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
    } finally {
      release();
      await cleanup;
    }
    const error = await attachment;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Cannot attach an unavailable listening episode');
  });
});
