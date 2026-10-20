// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Worker } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { createQueue, createWorker, withDispatchQueue } from '@/lib/queue';
import { closeRedis } from '@/lib/redis';
import { requestVocabularyAudio } from '@/lib/vocabulary/audio';
import { readVocabularyAudio } from '@/lib/vocabulary/audio/read';
import { startVocabularyStudy } from '@/lib/vocabulary/study-admission';
import { actOnVocabularyStudy } from '@/lib/vocabulary/study-actions';
import { processVocabularyAudio } from '@/workers/vocabulary/audio.worker';
import { authorizedLearnerExecution } from '../../helpers/runtime/provider-execution';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { reconcileSottoJobs } from '@/lib/sidedoor/jobs/core/job-reconciliation';
import { durableQueueOperationId } from '@/lib/sidedoor/jobs/core/durable-queue';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null, storageFails: false }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('@/lib/sidedoor/storage/core/storage-write', async (original) => {
  const actual = await original<typeof import('@/lib/sidedoor/storage/core/storage-write')>();
  return {
    ...actual,
    writeStorageReference: async (...args: Parameters<typeof actual.writeStorageReference>) => {
      if (boundary.storageFails) throw new Error('Storage publication acknowledgement lost');
      return actual.writeStorageReference(...args);
    },
  };
});

const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SIDEDOOR_TEST_REDIS_URL
    ? describe
    : describe.skip;
suite('persistent local dictionary pronunciation', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let courseId: string;
  let wordId: string;
  let root: string;
  let worker: Worker;
  let calls: Array<{ text: string; voice: string; model: string }>;
  let failTransport: boolean;
  const audio = Buffer.alloc(48);
  audio.write('RIFF');
  audio.writeUInt32LE(40, 4);
  audio.write('WAVE', 8);
  const queue = () => createQueue('vocabulary-audio');
  const execution = () => ({
    ...authorizedLearnerExecution(identity.ownerId),
    authorize: async (database: Parameters<typeof sottoAccessStore>[0]) => {
      await sottoAccessStore(database);
      return { userId: identity.ownerId };
    },
  });
  const subject = () => ({ courseId, wordId });

  beforeAll(async () => {
    vi.stubEnv('REDIS_URL', process.env.SIDEDOOR_TEST_REDIS_URL!);
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    instance = await createSharedTestInstance('vocabulary_audio');
    boundary.database = instance.database;
    root = await mkdtemp(join(tmpdir(), 'sotto-vocabulary-test-'));
    await mkdir(join(root, 'storage'));
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(root, 'executions'));
  });
  beforeEach(async () => {
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(root, 'executions'));
    identity = await instance.reset();
    calls = [];
    failTransport = false;
    boundary.storageFails = false;
    await queue().drain(true);
    await instance.configureInfrastructure({
      ttsProvider: 'local',
      ttsBaseUrl: 'http://vocabulary-local.test:8000',
      ttsVoices: 'voice-a,voice-b',
      storageProvider: 'local',
      localStorageRoot: join(root, 'storage'),
    });
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: { preferredTtsProvider: 'local', preferredTtsModel: 'fixture-local' },
    });
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Audio fixture' },
      update: {},
    });
    courseId = (
      await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          curriculumId: curriculum.id,
          nativeLang: 'en',
          targetLang: 'de',
        },
      })
    ).id;
    wordId = (
      await instance.database.learnerVocab.create({
        data: { courseId, lemma: 'Bahnhof', translation: 'station' },
      })
    ).id;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url !== 'http://vocabulary-local.test:8000/tts')
        throw new Error(`Unexpected destination ${request.url}`);
      calls.push((await request.json()) as { text: string; voice: string; model: string });
      if (failTransport) throw new Error('Connection lost after dispatch');
      return new Response(audio);
    });
    worker = createWorker('vocabulary-audio', processVocabularyAudio, { concurrency: 2 });
    await worker.waitUntilReady();
  });
  afterEach(async () => {
    await worker?.close();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await queue().close();
    await closeRedis();
    boundary.database = null;
    await instance?.close();
    if (root) await rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
  async function waitForAsset(status = 'READY') {
    await expect
      .poll(
        async () =>
          (
            await instance.database.vocabularyPronunciation.findFirst({
              where: { courseId },
              orderBy: { createdAt: 'desc' },
            })
          )?.status,
        { timeout: 10000, interval: 50 }
      )
      .toBe(status);
  }

  it('recovers a terminal failure before the pronunciation handler starts without synthesizing twice', async () => {
    const blocked = join(root, 'not-an-execution-directory');
    await writeFile(blocked, 'blocked');
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', blocked);
    worker.removeAllListeners('failed');
    await requestVocabularyAudio(subject(), execution());
    const asset = await instance.database.vocabularyPronunciation.findFirstOrThrow({
      where: { courseId },
    });
    const operationId = durableQueueOperationId(
      'vocabulary-audio',
      `${asset.id}-${asset.generation}`
    );
    await expect.poll(async () => (await queue().getJob(operationId))?.getState()).toBe('failed');
    await waitForAsset('QUEUED');
    const unsafeLookup = vi.spyOn(queue(), 'getJob').mockImplementation(() => {
      throw new Error('Recovery must use the bounded dispatcher connection.');
    });
    try {
      const reconciled = await reconcileSottoJobs({
        database: instance.database,
        queues: new Map([['vocabulary-audio', queue()]]),
        cursor: null,
        signal: new AbortController().signal,
        withQueue: withDispatchQueue,
      });
      expect(reconciled.results).toEqual(
        expect.arrayContaining([expect.objectContaining({ status: 'complete' })])
      );
    } finally {
      unsafeLookup.mockRestore();
    }
    await waitForAsset('FAILED');
    expect(calls).toEqual([]);
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(root, 'executions'));
    await requestVocabularyAudio(subject(), execution(), true);
    await waitForAsset();
    expect(calls).toHaveLength(1);
  });

  it('shares concurrent first requests and reuses the stored audio across subsequent requests', async () => {
    await Promise.all([
      requestVocabularyAudio(subject(), execution()),
      requestVocabularyAudio(subject(), execution()),
    ]);
    await waitForAsset();
    const played = await readVocabularyAudio(subject(), execution());
    expect(played).toEqual({ bytes: audio, mime: 'audio/wav' });
    expect(calls).toEqual([expect.objectContaining({ text: 'Bahnhof', model: 'fixture-local' })]);
    await worker.close();
    expect(await requestVocabularyAudio(subject(), execution())).toMatchObject({ status: 'READY' });
    expect((await readVocabularyAudio(subject(), execution())).bytes).toEqual(audio);
    expect(await instance.database.vocabularyPronunciation.count({ where: { courseId } })).toBe(1);
    expect(calls).toHaveLength(1);
    expect(
      await instance.database.learnerVocab.findUniqueOrThrow({ where: { id: wordId } })
    ).toMatchObject({ reps: 0, introducedAt: null, mastery: 0 });
  });

  it('creates a new asset when the actual local voice changes', async () => {
    await requestVocabularyAudio(subject(), execution());
    await waitForAsset();
    await instance.configureInfrastructure({
      ttsProvider: 'local',
      ttsBaseUrl: 'http://vocabulary-local.test:8000',
      ttsVoices: 'voice-c',
      storageProvider: 'local',
      localStorageRoot: join(root, 'storage'),
    });
    await requestVocabularyAudio(subject(), execution());
    await expect
      .poll(
        () =>
          instance.database.vocabularyPronunciation.count({ where: { courseId, status: 'READY' } }),
        { timeout: 10000 }
      )
      .toBe(2);
    expect(calls.map((call) => call.voice)).toEqual([
      expect.stringMatching(/^voice-[ab]$/),
      'voice-c',
    ]);
  });

  it('does not replay synthesis after an unknown transport outcome', async () => {
    failTransport = true;
    await requestVocabularyAudio(subject(), execution());
    await waitForAsset('UNRESOLVED');
    await expect(requestVocabularyAudio(subject(), execution(), true)).rejects.toThrow('cleanup');
    expect(calls).toHaveLength(1);
  });

  it('does not replay synthesis after an unknown storage publication', async () => {
    boundary.storageFails = true;
    await requestVocabularyAudio(subject(), execution());
    await waitForAsset('UNRESOLVED');
    await expect(requestVocabularyAudio(subject(), execution(), true)).rejects.toThrow('cleanup');
    expect(calls).toHaveLength(1);
  });

  it('requires listening playback before grading without exposing the word in the public prompt', async () => {
    const study = await startVocabularyStudy(courseId, execution(), {
      requestId: crypto.randomUUID(),
      mode: 'LISTENING_RECALL',
      wordIds: [wordId],
    });
    expect(JSON.stringify(study)).not.toContain('Bahnhof');
    const cardId = study.cards[0]!.id;
    const action = { action: 'ANSWER', itemId: cardId, answer: 'station', expectedRevision: 0 };
    await expect(actOnVocabularyStudy(study.sessionId, execution(), action)).rejects.toThrow(
      'Play'
    );
    const cardSubject = { sessionId: study.sessionId, cardId };
    await requestVocabularyAudio(cardSubject, execution());
    await waitForAsset();
    await expect(actOnVocabularyStudy(study.sessionId, execution(), action)).rejects.toThrow(
      'Play'
    );
    await readVocabularyAudio(cardSubject, execution());
    expect(
      (await actOnVocabularyStudy(study.sessionId, execution(), action)).cards[0]!.feedback?.correct
    ).toBe(true);
  });

  it('rejects disabled speech and another learner without contacting any speech provider', async () => {
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: { preferredTtsProvider: 'disabled' },
    });
    await expect(requestVocabularyAudio(subject(), execution())).rejects.toThrow('disabled');
    await expect(
      requestVocabularyAudio(subject(), { ...execution(), userId: 'another-learner' })
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
