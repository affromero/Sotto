// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@/generated/prisma/client';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { linkPreparationAudio } from '../../helpers/runtime/preparation-audio';
import { registerPreparationAudio } from '@/lib/classes/preparation-audio';
import { learningScriptHash } from '@/lib/learning/script-hash';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SIDEDOOR_TEST_REDIS_URL
    ? describe
    : describe.skip;
suite('listening audio ownership at durable admission', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let listening: typeof import('@/lib/class-listening-generator');
  let queue: typeof import('@/lib/queue');
  const jobs: string[] = [];
  beforeAll(async () => {
    const url = new URL(process.env.SIDEDOOR_TEST_REDIS_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use disposable local Redis database15');
    vi.stubEnv('REDIS_URL', url.toString());
    instance = await createSharedTestInstance('listening_association');
    boundary.database = instance.database;
    listening = await import('@/lib/class-listening-generator');
    queue = await import('@/lib/queue');
  });
  beforeEach(async () => {
    identity = await instance.reset();
  });
  afterAll(async () => {
    for (const id of jobs) await (await queue.audioGenerationQueue.getJob(id))?.remove();
    await queue?.audioGenerationQueue.close();
    await (await import('@/lib/redis')).closeRedis();
    boundary.database = null;
    await instance?.close();
    vi.unstubAllEnvs();
  });

  it('retains the admitted replacement audio when delivery acknowledgment is lost', async () => {
    const { restartExistingSegmentAudio } = await import('@/lib/segment-creator');
    const { durableQueueOperationId, DurableDeliveryPendingError } =
      await import('@/lib/sidedoor/jobs/core/durable-queue');
    const { sottoTransaction } = await import('@/lib/sidedoor/access/state/transaction');
    const { sottoJobOutbox, deliverSottoJob } =
      await import('@/lib/sidedoor/jobs/core/job-delivery');
    const generationKey = randomUUID();
    const episode = await instance.database.episode.create({
      data: {
        userId: identity.ownerId,
        title: 'Fixture',
        topic: 'Greetings',
        status: 'GENERATING_AUDIO',
        audioGenerationKey: generationKey,
      },
    });
    const segment = await instance.database.segment.create({
      data: { episodeId: episode.id, order: 0, speaker: 'HOST', text: 'Привет' },
    });
    const actualQueue = queue.createQueue('audio-generation');
    const add = actualQueue.add.bind(actualQueue);
    const lost = vi.spyOn(actualQueue, 'add').mockImplementationOnce(async (...args) => {
      await add(...args);
      throw new Error('Lost delivery acknowledgment');
    });
    try {
      const failure = await restartExistingSegmentAudio(episode.id, generationKey, {
        authorize: async () => ({ userId: identity.ownerId }),
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(DurableDeliveryPendingError);
      const updated = await instance.database.segment.findUniqueOrThrow({
        where: { id: segment.id },
      });
      expect(updated.version).toBe(segment.version + 1);
      const operationId = durableQueueOperationId(
        queue.audioGenerationQueue.name,
        `audio-${episode.id}-${segment.id}-v${updated.version}-${generationKey}`
      );
      jobs.push(operationId);
      expect((failure as InstanceType<typeof DurableDeliveryPendingError>).operationId).toBe(
        operationId
      );
      const record = await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(operationId)
      );
      expect(record).not.toBeNull();
      await expect(
        deliverSottoJob({
          database: instance.database,
          queue: actualQueue,
          operationId,
          fingerprint: record!.fingerprint,
          version: 1,
        })
      ).resolves.toBe('delivered');
      expect(
        await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })
      ).toMatchObject({
        status: 'GENERATING_AUDIO',
        audioGenerationKey: generationKey,
      });
    } finally {
      lost.mockRestore();
    }
  });

  it('replays a reserved generation without resetting segments or creating new children', async () => {
    const { createSegmentsAndQueueAudio } = await import('@/lib/segment-creator');
    const { durableQueueOperationId } = await import('@/lib/sidedoor/jobs/core/durable-queue');
    const episode = await instance.database.episode.create({
      data: {
        userId: identity.ownerId,
        title: 'Reserved audio',
        topic: 'Greetings',
        status: 'SCRIPT_READY',
      },
    });
    const generationKey = randomUUID();
    const turns = [
      { speaker: 'HOST', text: 'Привет' },
      { speaker: 'EXPERT', text: 'Здравствуйте' },
    ];
    const admission = {
      authorize: async () => ({ userId: identity.ownerId }),
      reservation: {
        generationKey,
        reconcile: async (
          database: import('@/generated/prisma/client').Prisma.TransactionClient,
          key: string
        ) => {
          await database.$queryRaw`SELECT id FROM "Episode" WHERE id = ${episode.id} FOR UPDATE`;
          const current = await database.episode.findUniqueOrThrow({ where: { id: episode.id } });
          if (current.status === 'SCRIPT_READY' && !current.audioGenerationKey)
            return 'CREATE' as const;
          if (current.audioGenerationKey === key) return 'REPLAY' as const;
          throw new Error('Audio reservation changed');
        },
      },
    };
    const actualQueue = queue.createQueue('audio-generation');
    const add = actualQueue.add.bind(actualQueue);
    const lostAcknowledgment = vi
      .spyOn(actualQueue, 'add')
      .mockImplementationOnce(async (...args) => {
        await add(...args);
        throw new Error('Lost delivery acknowledgment');
      });
    try {
      await expect(createSegmentsAndQueueAudio(episode.id, turns, admission)).rejects.toThrow(
        'Lost delivery acknowledgment'
      );
    } finally {
      lostAcknowledgment.mockRestore();
    }
    await Promise.all([
      createSegmentsAndQueueAudio(episode.id, turns, admission),
      createSegmentsAndQueueAudio(episode.id, turns, admission),
    ]);
    const before = await instance.database.segment.findMany({
      where: { episodeId: episode.id },
      orderBy: { order: 'asc' },
    });
    expect(before).toHaveLength(2);
    for (const segment of before)
      jobs.push(
        durableQueueOperationId(
          queue.audioGenerationQueue.name,
          `audio-${episode.id}-${segment.id}-v${segment.version}-${generationKey}`
        )
      );
    await instance.database.segment.update({
      where: { id: before[0]!.id },
      data: { audioUrl: '/completed.wav' },
    });
    await createSegmentsAndQueueAudio(episode.id, turns, admission);
    const after = await instance.database.segment.findMany({
      where: { episodeId: episode.id },
      orderBy: { order: 'asc' },
    });
    expect(after.map((item) => ({ id: item.id, version: item.version }))).toEqual(
      before.map((item) => ({ id: item.id, version: item.version }))
    );
    expect(after[0]!.audioUrl).toBe('/completed.wav');
    let resume!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const mutableTurns = structuredClone(turns);
    const pausedAdmission = {
      ...admission,
      reservation: {
        ...admission.reservation,
        reconcile: async (
          database: import('@/generated/prisma/client').Prisma.TransactionClient,
          key: string
        ) => {
          entered();
          await barrier;
          return admission.reservation.reconcile(database, key);
        },
      },
    };
    const paused = createSegmentsAndQueueAudio(episode.id, mutableTurns, pausedAdmission);
    await waiting;
    mutableTurns[0]!.text = 'Mutated after admission';
    resume();
    await paused;
    expect(
      (await instance.database.segment.findUniqueOrThrow({ where: { id: before[0]!.id } })).text
    ).toBe('Привет');
    await expect(
      createSegmentsAndQueueAudio(
        episode.id,
        [{ ...turns[0]!, text: 'Changed' }, turns[1]!],
        admission
      )
    ).rejects.toThrow('The reserved audio generation changed');
  });

  it.each(['unqueued', 'admitted', 'unknown', 'other-owner'] as const)(
    'retires only unqueued class audio after failure (%s)',
    async (kind) => {
      const episode = await instance.database.episode.create({
        data: {
          userId: identity.ownerId,
          title: 'Prepared class',
          topic: 'Greetings',
          source: 'CLASS',
          status: kind === 'admitted' ? 'GENERATING_AUDIO' : 'SCRIPT_READY',
          audioGenerationKey:
            kind === 'admitted' || kind === 'unknown' ? 'retained-audio-key' : null,
        },
      });
      await listening.failUnqueuedClassListening(
        episode.id,
        kind === 'other-owner' ? 'another-owner' : identity.ownerId
      );
      const saved = await instance.database.episode.findUniqueOrThrow({
        where: { id: episode.id },
      });
      expect(saved.status).toBe(kind === 'unqueued' ? 'FAILED' : episode.status);
      expect(saved.audioGenerationKey).toBe(episode.audioGenerationKey);
    }
  );

  it.each(['class', 'practice', 'exam'] as const)(
    'captures the final %s association before delivering audio',
    async (kind) => {
      const db = instance.database;
      const curriculum = await db.curriculum.upsert({
        where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
        update: {},
        create: { nativeLang: 'en', targetLang: 'de', title: 'Fixture' },
      });
      const course = await db.course.create({
        data: {
          userId: identity.ownerId,
          curriculumId: curriculum.id,
          nativeLang: 'en',
          targetLang: 'de',
        },
      });
      const episode = await db.episode.create({
        data: {
          userId: identity.ownerId,
          title: 'Fixture',
          topic: 'Greetings',
          source: 'CLASS',
          status: 'SCRIPT_READY',
        },
      });
      let associationId: string;
      let audioParent: Parameters<typeof listening.queueListeningAudio>[2];
      const execution: SottoProviderExecution = {
        userId: identity.ownerId,
        authorize: async (database) => {
          const owner = await database.course.findFirst({
            where: { id: course.id, userId: identity.ownerId },
          });
          if (!owner) throw new Error('Course ownership changed');
          return { userId: identity.ownerId };
        },
      };
      if (kind === 'practice') {
        await instance.configureInfrastructure({
          aiProvider: 'local',
          aiModel: 'admission-fixture',
          aiBaseUrl: 'http://127.0.0.1:34991/v1',
          ttsProvider: 'local',
          ttsBaseUrl: 'http://127.0.0.1:34991',
          ttsVoices: 'fixture-voice',
        });
        await db.user.update({
          where: { id: identity.ownerId },
          data: {
            preferredAiProvider: 'local',
            preferredAiModel: 'local:admission-fixture',
            preferredTtsModel: 'local:local',
          },
        });
        await db.lesson.upsert({
          where: { curriculumId_order: { curriculumId: curriculum.id, order: 1 } },
          update: { grammarPoints: ['present'], targetVocab: [{ lemma: 'Hallo', gloss: 'hello' }] },
          create: {
            curriculumId: curriculum.id,
            level: 'A1',
            order: 1,
            slug: 'full-admission',
            title: 'Greetings',
            objective: 'Greet someone',
            grammarPoints: ['present'],
            vocabThemes: ['greetings'],
            targetVocab: [{ lemma: 'Hallo', gloss: 'hello' }],
          },
        });
        const { requestPracticePreparation, writePracticePreparation } =
          await import('@/lib/practice/preparation');
        const operation = await requestPracticePreparation(course.id, 'FULL', execution);
        associationId = operation.sessionId;
        audioParent = { practiceSessionId: associationId };
        await db.practiceSession.update({
          where: { id: associationId },
          data: { episodeId: episode.id },
        });
        const { sottoTransaction } = await import('@/lib/sidedoor/access/state/transaction');
        await sottoTransaction(db, (tx) =>
          writePracticePreparation(tx, { ...operation, status: 'RUNNING' })
        );
        execution.registerAudioEpisode = (tx, episodeId, generationKey) =>
          registerPreparationAudio(tx, operation, episodeId, generationKey, 'practice');
      } else if (kind === 'class') {
        const lesson = await db.lesson.create({
          data: {
            curriculumId: curriculum.id,
            level: 'A1',
            order: 1,
            slug: 'greetings',
            title: 'Greetings',
            objective: 'Greet someone',
            grammarPoints: [],
            vocabThemes: [],
            targetVocab: [],
          },
        });
        const cls = await db.courseClass.create({
          data: { courseId: course.id, lessonId: lesson.id, order: 1, status: 'GENERATING' },
        });
        audioParent = { classId: cls.id, attempt: cls.attempt };
        associationId = (
          await db.classSection.create({
            data: {
              classId: cls.id,
              skill: 'LISTENING',
              status: 'READY',
              seed: 'fixture',
              spec: {},
              episodeId: episode.id,
            },
          })
        ).id;
        const operation = await linkPreparationAudio(db, identity.ownerId, episode.id, {
          courseId: course.id,
          deferRegistration: true,
        });
        execution.registerAudioEpisode = (tx, episodeId, generationKey) =>
          registerPreparationAudio(tx, operation, episodeId, generationKey);
      } else {
        const exam = await db.mockExam.create({
          data: {
            userId: identity.ownerId,
            courseId: course.id,
            institution: 'GOETHE',
            level: 'A1',
            blueprintId: 'fixture',
          },
        });
        associationId = (
          await db.examSection.create({
            data: {
              examId: exam.id,
              skill: 'LISTENING',
              part: 'Listening',
              order: 1,
              format: 'listening',
              episodeId: episode.id,
            },
          })
        ).id;
        audioParent = { examId: exam.id, examSectionId: associationId };
      }
      const turns = [];
      for (let index = 0; index < 22; index++)
        turns.push({
          speaker: index % 2 === 0 ? 'HOST' : 'GUEST',
          text: `Guten Morgen. Satz ${index + 1}.`,
        });
      await db.script.create({ data: { episodeId: episode.id, turns, markdown: 'Fixture' } });
      if ('practiceSessionId' in audioParent)
        await db.practiceSession.update({
          where: { id: audioParent.practiceSessionId },
          data: { listeningScriptHash: learningScriptHash(turns) },
        });
      await listening.queueListeningAudio(
        {
          episodeId: episode.id,
          comprehensionQuestions: [],
          turns,
        },
        execution,
        audioParent
      );
      const { sottoJobOutbox } = await import('@/lib/sidedoor/jobs/core/job-delivery');
      const { validateDurableAuthority } = await import('@/lib/sidedoor/jobs/core/durable-queue');
      const { sottoTransaction } = await import('@/lib/sidedoor/access/state/transaction');
      await sottoTransaction(db, async (database) => {
        const outbox = sottoJobOutbox(database);
        const page = await outbox.listIncomplete(null);
        const audio = [];
        for (const child of page.jobs) {
          const record = await outbox.read(child.id);
          if (record?.job.handler === queue.audioGenerationQueue.name) audio.push(record);
        }
        expect(audio).toHaveLength(22);
        let firstAuthority: Parameters<typeof validateDurableAuthority>[1] | undefined;
        for (const record of audio) {
          jobs.push(record.job.id);
          const authority = (
            record.job.payload as { authority: Parameters<typeof validateDurableAuthority>[1] }
          ).authority;
          expect(authority.kind).toBe('episode');
          if (authority.kind !== 'episode') throw new Error('Expected episode ownership');
          if (!firstAuthority) firstAuthority = authority;
          expect(authority).toEqual(firstAuthority);
          expect(authority.snapshot).toMatchObject({
            associations: {
              [kind === 'practice' ? 'practiceSession' : `${kind}Section`]:
                kind === 'practice' ? associationId : { id: associationId },
            },
          });
        }
        if (!firstAuthority) throw new Error('Expected admitted audio');
        await expect(validateDurableAuthority(database, firstAuthority)).resolves.toEqual({
          userId: identity.ownerId,
        });
      });
      expect(await db.segment.count({ where: { episodeId: episode.id } })).toBe(22);
      expect((await db.episode.findUniqueOrThrow({ where: { id: episode.id } })).status).toBe(
        'GENERATING_AUDIO'
      );
    }
  );
});
