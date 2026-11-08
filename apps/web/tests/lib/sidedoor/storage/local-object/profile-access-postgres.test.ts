// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { registerReferenceAudioCase } from './profile-cases/reference-audio';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  prepareStorageBackend,
  prepareStorageReference,
  StorageBackendRegistry,
  StorageReferenceRegistry,
} from 'thesidedoor-core/storage';
import type { PrismaClient } from '@/generated/prisma/client';
import { captureStorageBackend, readAttributedStorageRange } from '@/lib/r2';
import * as storageRuntime from '@/lib/r2';
import { captureSpeakingHistoryAudio } from '@/lib/classes/speaking/speaking-history-audio';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { canReadLocalObjectConsumer } from '@/lib/storage/sidedoor/local-object-access';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  userId: null as string | null,
  failTransactions: false,
}));
vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: async () => (boundary.userId ? { userId: boundary.userId } : null),
}));
vi.mock('@/lib/sidedoor/access/core/request-identity', () => ({
  requireOriginalSottoAdmission: async () => {},
}));
vi.mock('@/lib/prisma', () => {
  const database = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === '$transaction' && boundary.failTransactions)
          return async () => {
            throw new Error('Database temporarily unavailable');
          };
        if (!boundary.database) throw new Error('Test database is not initialized');
        const value = boundary.database[property as keyof PrismaClient];
        return typeof value === 'function' ? value.bind(boundary.database) : value;
      },
    }
  );
  return { prisma: database, prismaUnfiltered: database };
});

const { GET } = await import('@/app/api/v1/storage/[...key]/route');
const { GET: getSpeakingAudio } =
  await import('@/app/api/v1/classes/[classId]/speaking/[promptId]/recordings/[recordingId]/audio/route');
const { GET: getReferenceAudio } =
  await import('@/app/api/v1/classes/[classId]/speaking/[promptId]/reference/audio/route');
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const PDF = Buffer.from('%PDF-1.7\nPrivate learner worksheet\n');

suite('local worksheet profile access', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let directory: string;
  let learnerId: string;
  let otherId: string;
  let key: string;
  let reference: string;
  let courseId: string;
  let classId: string;

  beforeAll(async () => {
    instance = await createSharedTestInstance('local_profile_access');
    boundary.database = instance.database;
    directory = await mkdtemp(join(tmpdir(), 'sotto-profile-download-'));
  });
  beforeEach(async () => {
    boundary.failTransactions = false;
    identity = await instance.reset();
    await instance.configureInfrastructure({
      storageProvider: 'local',
      localStorageRoot: directory,
    });
    learnerId = (await identity.household('Worksheet learner')).id;
    otherId = (await identity.household('Other learner')).id;
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'es' } },
      create: { nativeLang: 'en', targetLang: 'es', title: 'Spanish' },
      update: {},
    });
    const lesson = await instance.database.lesson.upsert({
      where: { curriculumId_slug: { curriculumId: curriculum.id, slug: 'greetings' } },
      create: {
        curriculumId: curriculum.id,
        level: 'A1',
        order: 1,
        slug: 'greetings',
        title: 'Greetings',
        objective: 'Introduce yourself',
        grammarPoints: [],
        vocabThemes: [],
        targetVocab: [],
      },
      update: {},
    });
    const course = await instance.database.course.create({
      data: { userId: learnerId, curriculumId: curriculum.id, nativeLang: 'en', targetLang: 'es' },
    });
    const cls = await instance.database.courseClass.create({
      data: { courseId: course.id, lessonId: lesson.id, order: 1, status: 'AVAILABLE' },
    });
    courseId = course.id;
    classId = cls.id;
    const backend = await captureStorageBackend();
    key = `worksheets/${cls.id}/worksheet.pdf`;
    reference = await backend.writeBuffer(key, PDF, 'application/pdf');
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const preparedBackend = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
        preparedBackend
      );
      const prepared = prepareStorageReference({
        namespace: SIDEDOOR_STATE_ID,
        operationId: randomUUID(),
        reference,
        localRoutePrefix: '/api/v1/storage',
        target: { backendId: preparedBackend.id, binding: preparedBackend.binding, key },
        scopes: [{ subjectId: `course:${course.id}`, generation: course.createdAt.getTime() }],
      });
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [{ consumer: `class:${cls.id}:worksheet`, previousReference: null }],
        next: prepared,
      });
      await database.courseClass.update({
        where: { id: cls.id },
        data: { worksheetPdfUrl: reference },
      });
    });
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function download(userId: string, range?: string) {
    boundary.userId = userId;
    return GET(
      new NextRequest(`http://localhost${reference}`, {
        headers: range ? { range } : undefined,
      }),
      {
        params: Promise.resolve({ key: key.split('/') }),
      }
    );
  }

  it('serves the current worksheet bytes to the learner who owns the class', async () => {
    const response = await download(learnerId);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PDF);
  });

  it('does not reveal another learner worksheet through its known file URL', async () => {
    expect((await download(otherId)).status).toBe(404);
  });

  it('does not grant the household owner access to another learner worksheet', async () => {
    expect((await download(identity.ownerId)).status).toBe(404);
  });

  it('does not grant access by pointing an unrelated profile field at the private URL', async () => {
    await instance.database.user.update({ where: { id: otherId }, data: { image: reference } });
    expect((await download(otherId)).status).toBe(404);
  });

  it('preserves owned byte ranges without caching across profile changes', async () => {
    const response = await download(learnerId, 'bytes=0-4');
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('%PDF-');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    for (const userId of [otherId, identity.ownerId]) {
      const denied = await download(userId, 'bytes=0-4');
      expect(denied.status).toBe(404);
      expect(denied.headers.get('cache-control')).toBe('private, no-store');
      expect(await denied.text()).not.toContain('%PDF-');
    }
  });

  it('surfaces a database outage through the real reader instead of reporting a missing file', async () => {
    boundary.failTransactions = true;
    const response = await download(learnerId);
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ error: 'Failed to read stored object' });
  });

  it('rejects historical attribution after its current registry consumer is retired', async () => {
    await sottoTransaction(instance.database, async (database) => {
      const registry = new StorageReferenceRegistry(
        {
          query: (sql, values) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      await registry.retire({
        operationId: randomUUID(),
        consumer: `class:${classId}:worksheet`,
        previousReference: reference,
      });
      expect(await registry.readReference(reference)).not.toBeNull();
    });
    expect((await download(learnerId)).status).toBe(404);
  });

  it.each([null, '/api/v1/storage/replacement.pdf'])(
    'rejects the old URL after the application reference changes to %s',
    async (next) => {
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { worksheetPdfUrl: next },
      });
      expect((await download(learnerId)).status).toBe(404);
    }
  );

  const readable = (consumer: string, userId = learnerId) =>
    sottoTransaction(instance.database, (database) =>
      canReadLocalObjectConsumer(database, userId, reference, consumer)
    );

  it('denies assessment episode assets while preserving an independently owned shared reference', async () => {
    const previousReference = reference;
    const backend = await captureStorageBackend();
    key = `shared/${randomUUID()}.pdf`;
    reference = await backend.writeBuffer(key, PDF, 'application/pdf');
    const assessment = await instance.database.classAssessment.create({
      data: {
        classId,
        courseId,
        userId: learnerId,
        classAttempt: 1,
        assessmentAttempt: 1,
        requirements: {},
        formativeRevision: 'revision',
        generationOperationId: 'shared-audio-operation',
      },
    });
    const section = await instance.database.classAssessmentSection.create({
      data: { assessmentId: assessment.id, skill: 'LISTENING', passThreshold: 0.7 },
    });
    const episode = await instance.database.$transaction(async (tx) => {
      const created = await tx.episode.create({
        data: {
          userId: learnerId,
          title: 'Listening',
          topic: 'Test',
          visibility: 'UNLISTED',
          audioUrl: reference,
          pdfUrl: reference,
          assessmentAudioAssessmentId: assessment.id,
          assessmentAudioSectionId: section.id,
          assessmentAudioOperationId: 'shared-audio-operation',
        },
      });
      await tx.classAssessmentSection.update({
        where: { id: section.id },
        data: {
          episodeId: created.id,
          audioReservationEpisodeId: created.id,
          audioReservationOperationId: 'shared-audio-operation',
        },
      });
      return created;
    });
    const segment = await instance.database.segment.create({
      data: {
        episodeId: episode.id,
        order: 0,
        speaker: 'HOST',
        text: 'Private',
        audioUrl: reference,
      },
    });
    const version = await instance.database.episodeVersion.create({
      data: { episodeId: episode.id, version: 1, audioUrl: reference, changeType: 'initial' },
    });
    const consumers = [
      `episode:${episode.id}:audio`,
      `episode:${episode.id}:transcript`,
      `segment:${segment.id}:audio`,
      `episode-version:${version.id}:audio`,
    ];
    await sottoTransaction(instance.database, async (database) => {
      const registry = new StorageReferenceRegistry(
        {
          query: (sql, values) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      const existing = await registry.resolve({
        consumer: `class:${classId}:worksheet`,
        reference: previousReference,
      });
      if (!existing) throw new Error('Missing worksheet registry reference');
      await registry.replaceMany({
        consumers: [
          { consumer: `class:${classId}:worksheet`, previousReference },
          ...consumers.map((consumer) => ({ consumer, previousReference: null })),
        ],
        next: prepareStorageReference({
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          reference,
          localRoutePrefix: '/api/v1/storage',
          target: { ...existing.prepared.target, key },
          scopes: existing.prepared.scopes,
        }),
      });
      await database.courseClass.update({
        where: { id: classId },
        data: { worksheetPdfUrl: reference },
      });
    });
    for (const consumer of consumers) {
      expect(await readable(consumer, learnerId)).toBe(false);
      expect(await readable(consumer, otherId)).toBe(false);
    }
    expect((await download(otherId)).status).toBe(404);
    expect((await download(learnerId)).status).toBe(200);
    await sottoTransaction(instance.database, async (database) => {
      const registry = new StorageReferenceRegistry(
        {
          query: (sql, values) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      await registry.retire({
        operationId: randomUUID(),
        consumer: `class:${classId}:worksheet`,
        previousReference: reference,
      });
    });
    expect((await download(learnerId)).status).toBe(404);
  });

  it('does not attach an episode whose local bytes are already served', async () => {
    const backend = await captureStorageBackend();
    key = `assessment/${randomUUID()}.pdf`;
    reference = await backend.writeBuffer(key, PDF, 'application/pdf');
    const episode = await instance.database.episode.create({
      data: { userId: learnerId, title: 'Listening', topic: 'Test', audioUrl: reference },
    });
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const stored = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(stored);
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [{ consumer: `episode:${episode.id}:audio`, previousReference: null }],
        next: prepareStorageReference({
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          reference,
          localRoutePrefix: '/api/v1/storage',
          target: { backendId: stored.id, binding: stored.binding, key },
          scopes: [{ subjectId: `episode:${episode.id}`, generation: episode.createdAt.getTime() }],
        }),
      });
    });
    expect((await download(learnerId)).status).toBe(200);
    const assessment = await instance.database.classAssessment.create({
      data: {
        classId,
        courseId,
        userId: learnerId,
        classAttempt: 1,
        assessmentAttempt: 1,
        requirements: {},
        formativeRevision: 'revision',
      },
    });
    await expect(
      instance.database.classAssessmentSection.create({
        data: {
          assessmentId: assessment.id,
          skill: 'LISTENING',
          passThreshold: 0.7,
          episodeId: episode.id,
        },
      })
    ).rejects.toThrow('Assessment audio must match its creation reservation');
    expect((await download(learnerId)).status).toBe(200);
  }, 15000);

  async function speakingSection() {
    return instance.database.classSection.create({
      data: { classId, skill: 'SPEAKING', seed: 'owned', spec: {} },
    });
  }

  async function practice() {
    return instance.database.practiceSession.create({
      data: { courseId, kind: 'SPEAKING', items: [], seed: 'owned' },
    });
  }

  it('protects learner recordings even when the household owner knows their reference', async () => {
    const section = await speakingSection();
    const prompt = await instance.database.speakingPrompt.create({
      data: { sectionId: section.id, order: 1, targetPhrase: 'Hola', translation: 'Hello' },
    });
    const recording = await instance.database.speakingRecording.create({
      data: { promptId: prompt.id, userId: learnerId, audioUrl: reference },
    });
    const consumer = `recording:${recording.id}:audio`;
    expect(await readable(consumer)).toBe(true);
    expect(await readable(consumer, otherId)).toBe(false);
    expect(await readable(consumer, identity.ownerId)).toBe(false);
  });

  registerReferenceAudioCase(() => ({
    instance,
    identity,
    directory,
    learnerId,
    otherId,
    courseId,
    classId,
    boundary,
    getReferenceAudio,
    speakingSection,
  }));

  it('plays an owned published recording with exact attribution and byte ranges', async () => {
    const section = await speakingSection();
    const prompt = await instance.database.speakingPrompt.create({
      data: {
        sectionId: section.id,
        order: 1,
        targetPhrase: 'Hola',
        translation: 'Hello',
      },
    });
    const backend = await captureStorageBackend();
    const audioKey = `recordings/${randomUUID()}.ogg`;
    const bytes = Buffer.concat([
      Buffer.from('OggS-'),
      Buffer.alloc(storageRuntime.STORAGE_RANGE_MAX_BYTES + 8, 97),
    ]);
    const audioReference = await backend.writeBuffer(audioKey, bytes, 'audio/ogg');
    const recording = await instance.database.speakingRecording.create({
      data: {
        promptId: prompt.id,
        sectionId: section.id,
        userId: learnerId,
        audioUrl: audioReference,
      },
    });
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const stored = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(stored);
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [{ consumer: `recording:${recording.id}:audio`, previousReference: null }],
        next: prepareStorageReference({
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          reference: audioReference,
          localRoutePrefix: '/api/v1/storage',
          target: { backendId: stored.id, binding: stored.binding, key: audioKey },
          scopes: [{ subjectId: `course:${courseId}`, generation: course.createdAt.getTime() }],
        }),
      });
    });
    const downloadRecording = (userId: string, range?: string, requestedPromptId = prompt.id) => {
      boundary.userId = userId;
      return getSpeakingAudio(
        new NextRequest('http://localhost/audio', { headers: range ? { range } : undefined }),
        {
          params: Promise.resolve({
            classId,
            promptId: requestedPromptId,
            recordingId: recording.id,
          }),
        }
      );
    };
    const full = await downloadRecording(learnerId);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('audio/ogg');
    expect(full.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
    const partial = await downloadRecording(learnerId, 'bytes=5-9');
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(`bytes 5-9/${bytes.length}`);
    expect(await partial.text()).toBe('aaaaa');
    const invalid = await downloadRecording(learnerId, `bytes=${bytes.length}-`);
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get('content-range')).toBe(`bytes */${bytes.length}`);
    expect((await downloadRecording(otherId)).status).toBe(404);
    expect((await downloadRecording(identity.ownerId)).status).toBe(404);
    expect((await downloadRecording(learnerId, undefined, 'other-prompt')).status).toBe(404);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const readRange = storageRuntime.readAttributedStorageRange;
    const spy = vi
      .spyOn(storageRuntime, 'readAttributedStorageRange')
      .mockImplementation(async (options) => {
        if (options.start === storageRuntime.STORAGE_RANGE_MAX_BYTES) {
          entered();
          await gate;
        }
        return readRange(options);
      });
    try {
      const interrupted = await downloadRecording(learnerId);
      const reader = interrupted.body!.getReader();
      expect((await reader.read()).value?.length).toBe(storageRuntime.STORAGE_RANGE_MAX_BYTES);
      await Promise.race([
        waiting,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Second audio range did not start')), 2000)
        ),
      ]);
      await instance.database.classSection.update({
        where: { id: section.id },
        data: { withdrawn: true },
      });
      release();
      await expect(reader.read()).rejects.toThrow('Recording authorization changed');
    } finally {
      release();
      spy.mockRestore();
      await instance.database.classSection.update({
        where: { id: section.id },
        data: { withdrawn: false },
      });
    }
    const unattributed = await instance.database.speakingRecording.create({
      data: {
        promptId: prompt.id,
        sectionId: section.id,
        userId: learnerId,
        audioUrl: audioReference,
      },
    });
    const missing = await getSpeakingAudio(new NextRequest('http://localhost/audio'), {
      params: Promise.resolve({ classId, promptId: prompt.id, recordingId: unattributed.id }),
    });
    expect(missing.status).toBe(502);
    expect(await missing.json()).toMatchObject({ error: 'Recording unavailable' });
    const captured = await sottoTransaction(instance.database, (database) =>
      captureSpeakingHistoryAudio(database, {
        classId,
        promptId: prompt.id,
        recordingId: recording.id,
        userId: learnerId,
      })
    );
    if (!captured) throw new Error('Expected authorized audio');
    const rangeInput = {
      input: captured.storage.input,
      descriptor: captured.storage.backend.descriptor,
      execution: { userId: learnerId, authorize: async () => ({ userId: learnerId }) },
      start: 0,
      end: 0,
    };
    const before = await readAttributedStorageRange(rangeInput);
    if (!before) throw new Error('Expected first audio range');
    await writeFile(join(directory, audioKey), Buffer.alloc(bytes.length, 65));
    await expect(
      readAttributedStorageRange({ ...rangeInput, expectedIdentity: before.identity })
    ).rejects.toThrow('Stored object identity changed');
    await instance.database.classSection.update({
      where: { id: section.id },
      data: { withdrawn: true },
    });
    expect((await downloadRecording(learnerId)).status).toBe(404);
  });

  it.each(['class', 'practice', 'exam'] as const)(
    'checks the actual %s speaking prompt parent owner',
    async (kind) => {
      const sectionId = kind === 'class' ? (await speakingSection()).id : null;
      const practiceSessionId = kind === 'practice' ? (await practice()).id : null;
      let examSectionId: string | null = null;
      if (kind === 'exam') {
        const exam = await instance.database.mockExam.create({
          data: {
            userId: otherId,
            courseId,
            institution: 'GOETHE',
            level: 'A1',
            blueprintId: 'goethe/a1',
          },
        });
        examSectionId = (
          await instance.database.examSection.create({
            data: {
              examId: exam.id,
              skill: 'SPEAKING',
              part: 'Introduction',
              order: 1,
              format: 'speaking',
            },
          })
        ).id;
      }
      const prompt = await instance.database.speakingPrompt.create({
        data: {
          sectionId,
          practiceSessionId,
          examSectionId,
          order: 1,
          targetPhrase: 'Hola',
          translation: 'Hello',
          referenceTtsUrl: reference,
        },
      });
      const consumer = `speaking-prompt:${prompt.id}:reference`;
      expect(await readable(consumer, kind === 'exam' ? otherId : learnerId)).toBe(true);
      expect(await readable(consumer, kind === 'exam' ? learnerId : otherId)).toBe(false);
    }
  );

  it('hides a withdrawn class reference until publication and retains access to published history', async () => {
    const section = await speakingSection();
    await instance.database.classSection.update({
      where: { id: section.id },
      data: { withdrawn: true },
    });
    const prompt = await instance.database.speakingPrompt.create({
      data: {
        sectionId: section.id,
        order: 1,
        targetPhrase: 'Hola',
        translation: 'Hello',
        referenceTtsUrl: reference,
      },
    });
    const consumer = `speaking-prompt:${prompt.id}:reference`;
    expect(await readable(consumer, learnerId)).toBe(false);
    await instance.database.classSection.update({
      where: { id: section.id },
      data: { withdrawn: false },
    });
    expect(await readable(consumer, learnerId)).toBe(true);
    await instance.database.classSection.create({
      data: {
        classId: section.classId,
        skill: 'SPEAKING',
        attempt: section.attempt + 1,
        seed: 'newer',
        spec: {},
        status: 'READY',
      },
    });
    expect(await readable(consumer, learnerId)).toBe(true);
    expect(await readable(consumer, otherId)).toBe(false);
  });

  it('serves staged speaking bytes only through an independently authorized consumer or after publication', async () => {
    const section = await speakingSection();
    const previousReference = reference;
    await instance.database.classSection.update({
      where: { id: section.id },
      data: { withdrawn: true },
    });
    const backend = await captureStorageBackend();
    key = `speaking-reference/${randomUUID()}.mp3`;
    reference = await backend.writeBuffer(
      key,
      Buffer.from('Private speaking reference'),
      'audio/mpeg'
    );
    const prompt = await instance.database.speakingPrompt.create({
      data: {
        sectionId: section.id,
        order: 1,
        targetPhrase: 'Hola',
        translation: 'Hello',
        referenceTtsUrl: reference,
      },
    });
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    const consumer = `speaking-prompt:${prompt.id}:reference`;
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const stored = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(stored);
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [
          { consumer, previousReference: null },
          { consumer: `class:${classId}:worksheet`, previousReference },
        ],
        next: prepareStorageReference({
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          reference,
          localRoutePrefix: '/api/v1/storage',
          target: { backendId: stored.id, binding: stored.binding, key },
          scopes: [{ subjectId: `course:${course.id}`, generation: course.createdAt.getTime() }],
        }),
      });
    });
    expect((await download(learnerId)).status).toBe(404);
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { worksheetPdfUrl: reference },
    });
    expect((await download(learnerId)).status).toBe(200);
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { worksheetPdfUrl: null },
    });
    expect((await download(learnerId)).status).toBe(404);
    await instance.database.classSection.update({
      where: { id: section.id },
      data: { withdrawn: false },
    });
    const allowed = await download(learnerId);
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe('Private speaking reference');
    expect((await download(otherId)).status).toBe(404);
  });

  it.each(['none', 'multiple'] as const)('rejects prompts with %s parents', async (kind) => {
    const prompt = await instance.database.speakingPrompt.create({
      data: {
        sectionId: kind === 'multiple' ? (await speakingSection()).id : null,
        practiceSessionId: kind === 'multiple' ? (await practice()).id : null,
        order: 1,
        targetPhrase: 'Hola',
        translation: 'Hello',
        referenceTtsUrl: reference,
      },
    });
    expect(await readable(`speaking-prompt:${prompt.id}:reference`)).toBe(false);
  });

  it.each([
    ['pronunciation', 'pronunciationAudioUrl'],
    ['visual', 'visualCueUrl'],
  ] as const)('protects the owned focus %s asset', async (slot, field) => {
    const focus = await instance.database.learnerFocusTarget.create({
      data: { courseId, kind: 'WORD', text: 'hola', normalizedText: 'hola', [field]: reference },
    });
    expect(await readable(`focus-target:${focus.id}:${slot}`)).toBe(true);
    expect(await readable(`focus-target:${focus.id}:${slot}`, otherId)).toBe(false);
  });

  it('protects vocabulary pronunciation through course ownership', async () => {
    const pronunciation = await instance.database.vocabularyPronunciation.create({
      data: {
        courseId,
        fingerprint: randomUUID(),
        text: 'hola',
        language: 'es',
        audioUrl: reference,
      },
    });
    expect(await readable(`vocabulary-audio:${pronunciation.id}:audio`)).toBe(true);
    expect(await readable(`vocabulary-audio:${pronunciation.id}:audio`, otherId)).toBe(false);
  });

  it.each([
    ['audio', 'audioUrl'],
    ['transcript', 'pdfUrl'],
    ['waveform', 'waveformUrl'],
    ['spectrogram', 'spectrogramUrl'],
  ] as const)('preserves episode visibility for its %s asset', async (slot, field) => {
    const episode = await instance.database.episode.create({
      data: {
        userId: learnerId,
        title: 'Private lesson',
        topic: 'Greetings',
        visibility: 'PRIVATE',
        [field]: reference,
      },
    });
    const consumer = `episode:${episode.id}:${slot}`;
    expect(await readable(consumer)).toBe(true);
    expect(await readable(consumer, otherId)).toBe(false);
    await instance.database.episode.update({
      where: { id: episode.id },
      data: { visibility: 'UNLISTED' },
    });
    expect(await readable(consumer, otherId)).toBe(true);
    await instance.database.episode.update({
      where: { id: episode.id },
      data: { deletedAt: new Date() },
    });
    expect(await readable(consumer)).toBe(false);
    expect(await readable(consumer, otherId)).toBe(false);
  });

  it.each(['segment', 'episode-version'] as const)(
    'checks the %s parent visibility',
    async (kind) => {
      const episode = await instance.database.episode.create({
        data: { userId: learnerId, title: 'Lesson', topic: 'Greetings', visibility: 'PRIVATE' },
      });
      const item =
        kind === 'segment'
          ? await instance.database.segment.create({
              data: {
                episodeId: episode.id,
                speaker: 'Teacher',
                text: 'Hola',
                order: 1,
                audioUrl: reference,
              },
            })
          : await instance.database.episodeVersion.create({
              data: {
                episodeId: episode.id,
                version: 1,
                audioUrl: reference,
                changeType: 'initial',
              },
            });
      const consumer = `${kind}:${item.id}:audio`;
      expect(await readable(consumer)).toBe(true);
      expect(await readable(consumer, otherId)).toBe(false);
      await instance.database.episode.update({
        where: { id: episode.id },
        data: { visibility: 'UNLISTED' },
      });
      expect(await readable(consumer, otherId)).toBe(true);
      await instance.database.episode.update({
        where: { id: episode.id },
        data: { deletedAt: new Date() },
      });
      expect(await readable(consumer)).toBe(false);
      expect(await readable(consumer, otherId)).toBe(false);
    }
  );

  it('keeps current profile avatars visible to other household profiles', async () => {
    await instance.database.user.update({ where: { id: learnerId }, data: { image: reference } });
    const consumer = `profile:${learnerId}:avatar`;
    expect(await readable(consumer, otherId)).toBe(true);
    await instance.database.user.update({ where: { id: learnerId }, data: { image: null } });
    expect(await readable(consumer, otherId)).toBe(false);
  });

  it.each([
    'material:document:original',
    'material:document:optimized',
    'upload-part:part:original',
    'unregistered:record:audio',
    'class::worksheet',
    'class:lesson:worksheet:extra',
  ])('denies generic reads for consumer %s', async (consumer) => {
    expect(await readable(consumer)).toBe(false);
  });
});
