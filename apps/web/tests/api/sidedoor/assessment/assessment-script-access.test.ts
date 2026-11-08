// @vitest-environment node
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { GET, PATCH as editScript } from '@/app/api/v1/episodes/[episodeId]/script/route';
import { POST as approveScript } from '@/app/api/v1/episodes/[episodeId]/script/approve/route';
import { POST as generateEpisode } from '@/app/api/v1/episodes/[episodeId]/generate/route';
import { POST as regenerateScript } from '@/app/api/v1/episodes/[episodeId]/script/regenerate/route';
import { POST as saveEpisode } from '@/app/api/v1/episodes/[episodeId]/save/route';
import { GET as streamEpisode } from '@/app/api/v1/episodes/[episodeId]/stream/route';
import { GET as listEpisodes } from '@/app/api/v1/episodes/route';
import {
  GET as getEpisode,
  PATCH as updateEpisode,
  DELETE as deleteEpisode,
} from '@/app/api/v1/episodes/[episodeId]/route';
import { POST as askEpisode } from '@/app/api/v1/episodes/[episodeId]/interact/route';
import { GET as getInteraction } from '@/app/api/v1/episodes/[episodeId]/interact/[interactionId]/route';
import { PATCH as resolveInteraction } from '@/app/api/v1/episodes/[episodeId]/interact/[interactionId]/resolve/route';
import { GET as getLocalObject } from '@/app/api/v1/storage/[...key]/route';
import {
  captureStorageBackend,
  readAssessmentAudioRange,
  readAttributedStorageRange,
} from '@/lib/r2';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import { getEpisodeForDetailPage, getShareableEpisodeMetadata } from '@/lib/episode-data';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import {
  prepareStorageBackend,
  prepareStorageReference,
  StorageBackendRegistry,
  StorageReferenceRegistry,
} from 'thesidedoor-core/storage';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  cachedEpisode: null as unknown,
}));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('@/lib/queue', () => ({
  admitDurableJob: vi.fn(),
  contentExtractionQueue: {},
  JobType: {},
}));
vi.mock('@/lib/redis', async (original) => {
  const actual = await original<typeof import('@/lib/redis')>();
  return {
    ...actual,
    cache: { ...actual.cache, get: async () => boundary.cachedEpisode, set: vi.fn() },
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('assessment script access', () => {
  let instance: SharedTestInstance;
  beforeAll(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost');
    instance = await createSharedTestInstance('assessment_script');
    boundary.database = instance.database;
  });
  afterAll(async () => {
    boundary.database = null;
    boundary.cachedEpisode = null;
    await instance?.close();
    vi.unstubAllEnvs();
  });

  it('keeps reserved assessment audio private across ordinary episode routes', async () => {
    const identity = await instance.reset();
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'ru' } },
      create: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
      update: {},
    });
    const lesson = await instance.database.lesson.create({
      data: {
        curriculumId: curriculum.id,
        slug: 'assessment-script',
        level: 'A1',
        order: 1,
        title: 'First lesson',
        objective: 'Greet',
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
      data: { courseId: course.id, lessonId: lesson.id, order: 1 },
    });
    const assessment = await instance.database.classAssessment.create({
      data: {
        classId: cls.id,
        courseId: course.id,
        userId: identity.ownerId,
        classAttempt: 1,
        assessmentAttempt: 1,
        requirements: {},
        formativeRevision: 'revision',
        generationOperationId: 'assessment-script-operation',
      },
    });
    const createReservedEpisode = async (
      assessmentId: string,
      operationId: string,
      title: string
    ) => {
      const section = await instance.database.classAssessmentSection.create({
        data: { assessmentId, skill: 'LISTENING', passThreshold: 0.7 },
      });
      return instance.database.$transaction(async (tx) => {
        const created = await tx.episode.create({
          data: {
            userId: identity.ownerId,
            title,
            topic: 'Greeting',
            assessmentAudioAssessmentId: assessmentId,
            assessmentAudioSectionId: section.id,
            assessmentAudioOperationId: operationId,
          },
        });
        await tx.classAssessmentSection.update({
          where: { id: section.id },
          data: {
            episodeId: created.id,
            audioReservationEpisodeId: created.id,
            audioReservationOperationId: operationId,
          },
        });
        return created;
      });
    };
    const episode = await createReservedEpisode(
      assessment.id,
      'assessment-script-operation',
      'Listening'
    );
    await instance.database.script.create({
      data: {
        episodeId: episode.id,
        markdown: 'SECRET',
        turns: [{ speaker: 'HOST', text: 'SECRET' }],
      },
    });
    const request = () =>
      new NextRequest(`http://localhost/api/v1/episodes/${episode.id}/script`, {
        headers: { cookie: `sotto_session=${identity.ownerToken}` },
      });
    const params = { params: Promise.resolve({ episodeId: episode.id }) };
    const response = GET(request(), params);
    boundary.cachedEpisode = {
      id: episode.id,
      userId: identity.ownerId,
      visibility: 'UNLISTED',
      status: 'READY',
      segments: [{ text: 'CACHED_SECRET' }],
    };
    const editResponse = editScript(
      new NextRequest(`http://localhost/api/v1/episodes/${episode.id}/script`, {
        method: 'PATCH',
        headers: {
          cookie: `sotto_session=${identity.ownerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ turns: [{ speaker: 'HOST', text: 'REPLACEMENT' }] }),
      }),
      params
    );
    const detailResponse = getEpisode(request(), params);
    const blocked = await response;
    expect(blocked.status).toBe(404);
    expect(blocked.headers.get('cache-control')).toBe('private, no-store');
    expect(JSON.stringify(await blocked.json())).not.toContain('SECRET');
    const blockedDetail = await detailResponse;
    expect(blockedDetail.status).toBe(404);
    expect(JSON.stringify(await blockedDetail.json())).not.toContain('CACHED_SECRET');
    expect((await editResponse).status).toBe(404);
    for (const handler of [regenerateScript, saveEpisode, streamEpisode]) {
      const response = await handler(
        new NextRequest(`http://localhost/api/v1/episodes/${episode.id}`, {
          method: handler === streamEpisode ? 'GET' : 'POST',
          headers: { cookie: `sotto_session=${identity.ownerToken}` },
        }),
        params
      );
      expect(response.status).toBe(404);
    }
    const patchResponse = await updateEpisode(
      new NextRequest(`http://localhost/api/v1/episodes/${episode.id}`, {
        method: 'PATCH',
        headers: {
          cookie: `sotto_session=${identity.ownerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ visibility: 'UNLISTED' }),
      }),
      params
    );
    expect(patchResponse.status).toBe(404);
    expect(
      await instance.database.script.findUniqueOrThrow({ where: { episodeId: episode.id } })
    ).toMatchObject({ markdown: 'SECRET' });
    expect(
      (
        await approveScript(
          new NextRequest(`http://localhost/api/v1/episodes/${episode.id}/script/approve`, {
            method: 'POST',
            headers: { cookie: `sotto_session=${identity.ownerToken}` },
          }),
          params
        )
      ).status
    ).toBe(404);
    const deleteResponse = await deleteEpisode(
      new NextRequest(`http://localhost/api/v1/episodes/${episode.id}`, {
        method: 'DELETE',
        headers: { cookie: `sotto_session=${identity.ownerToken}` },
      }),
      params
    );
    expect(deleteResponse.status).toBe(404);
    expect(
      await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })
    ).toMatchObject({
      visibility: 'PRIVATE',
      deletedAt: null,
    });
    boundary.cachedEpisode = null;
    expect(await getEpisodeForDetailPage(episode.id)).toBeNull();
    expect(await getShareableEpisodeMetadata(episode.id)).toBeNull();
    const interaction = await instance.database.interaction.create({
      data: {
        episodeId: episode.id,
        userId: identity.ownerId,
        question: 'What was said?',
        timestamp: 1,
        status: 'ANSWERED',
        answer: 'PRIVATE_ASSESSMENT_ANSWER',
      },
    });
    const interactionRequest = new NextRequest(
      `http://localhost/api/v1/episodes/${episode.id}/interact`,
      {
        method: 'POST',
        headers: {
          cookie: `sotto_session=${identity.ownerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ question: 'What was said?', timestamp: 1 }),
      }
    );
    expect((await askEpisode(interactionRequest, params)).status).toBe(404);
    expect(await instance.database.interaction.count({ where: { episodeId: episode.id } })).toBe(1);
    const poll = await getInteraction(request(), {
      params: Promise.resolve({ episodeId: episode.id, interactionId: interaction.id }),
    });
    expect(poll.status).toBe(404);
    expect(JSON.stringify(await poll.json())).not.toContain('PRIVATE_ASSESSMENT_ANSWER');

    const secondClass = await instance.database.courseClass.create({
      data: { courseId: course.id, lessonId: lesson.id, order: 2 },
    });
    const secondAssessment = await instance.database.classAssessment.create({
      data: {
        classId: secondClass.id,
        courseId: course.id,
        userId: identity.ownerId,
        classAttempt: 1,
        assessmentAttempt: 1,
        requirements: {},
        formativeRevision: 'revision',
        generationOperationId: 'second-operation',
      },
    });
    const secondEpisode = await createReservedEpisode(
      secondAssessment.id,
      'second-operation',
      'Second'
    );
    await instance.database.script.create({
      data: {
        episodeId: secondEpisode.id,
        markdown: 'OTHER',
        turns: [{ speaker: 'HOST', text: 'OTHER' }],
      },
    });
    const secondRequest = () =>
      new NextRequest(`http://localhost/api/v1/episodes/${secondEpisode.id}/script`, {
        headers: { cookie: `sotto_session=${identity.ownerToken}` },
      });
    const secondParams = { params: Promise.resolve({ episodeId: secondEpisode.id }) };
    expect((await GET(secondRequest(), secondParams)).status).toBe(404);

    const thirdClass = await instance.database.courseClass.create({
      data: { courseId: course.id, lessonId: lesson.id, order: 3 },
    });
    const thirdAssessment = await instance.database.classAssessment.create({
      data: {
        classId: thirdClass.id,
        courseId: course.id,
        userId: identity.ownerId,
        classAttempt: 1,
        assessmentAttempt: 1,
        requirements: {},
        formativeRevision: 'revision',
        generationOperationId: 'third-operation',
      },
    });
    const thirdEpisode = await createReservedEpisode(
      thirdAssessment.id,
      'third-operation',
      'Third'
    );
    await instance.database.episode.update({
      where: { id: thirdEpisode.id },
      data: { status: 'FAILED' },
    });
    const generation = generateEpisode(
      new NextRequest(
        `http://localhost/api/v1/episodes/${thirdEpisode.id}/generate?forceRestart=true`,
        {
          method: 'POST',
          headers: { cookie: `sotto_session=${identity.ownerToken}` },
        }
      ),
      { params: Promise.resolve({ episodeId: thirdEpisode.id }) }
    );
    expect((await generation).status).toBe(404);
    expect(
      await instance.database.episode.findUniqueOrThrow({ where: { id: thirdEpisode.id } })
    ).toMatchObject({ status: 'FAILED' });

    const ordinary = await instance.database.episode.create({
      data: {
        userId: identity.ownerId,
        title: 'Ordinary episode',
        topic: 'Greeting',
        visibility: 'UNLISTED',
        learningAudioIdentity: { secret: 'PRIVATE_STORAGE_IDENTITY' },
      },
    });
    const ordinaryInteraction = await instance.database.interaction.create({
      data: {
        episodeId: ordinary.id,
        userId: identity.ownerId,
        question: 'Hello?',
        timestamp: 1,
        status: 'ANSWERED',
        answer: 'Hello!',
      },
    });
    const ordinaryPoll = await getInteraction(
      new NextRequest(
        `http://localhost/api/v1/episodes/${ordinary.id}/interact/${ordinaryInteraction.id}`,
        {
          headers: { cookie: `sotto_session=${identity.ownerToken}` },
        }
      ),
      { params: Promise.resolve({ episodeId: ordinary.id, interactionId: ordinaryInteraction.id }) }
    );
    expect(ordinaryPoll.status).toBe(200);
    expect(ordinaryPoll.headers.get('cache-control')).toBe('private, no-store');
    expect(await ordinaryPoll.json()).toMatchObject({ answer: 'Hello!' });
    const tag = await instance.database.tag.create({
      data: { name: 'Languages', slug: 'languages' },
    });
    await instance.database.episodeTag.create({ data: { episodeId: ordinary.id, tagId: tag.id } });
    const other = await identity.household('Other learner');
    const otherEpisode = await instance.database.episode.create({
      data: { userId: other.id, title: 'Another learner', topic: 'Greeting' },
    });
    expect(await getEpisodeForDetailPage(ordinary.id)).toMatchObject({ id: ordinary.id });
    expect(await getShareableEpisodeMetadata(ordinary.id)).toMatchObject({
      title: 'Ordinary episode',
    });
    expect(await getShareableEpisodeMetadata(otherEpisode.id)).toBeNull();
    const resolveRequest = (token: string) =>
      new NextRequest('http://localhost/api/v1/resolve', {
        method: 'PATCH',
        headers: { cookie: `sotto_session=${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ helpful: true }),
      });
    const resolveParams = (targetEpisode: string, targetInteraction: string) => ({
      params: Promise.resolve({ episodeId: targetEpisode, interactionId: targetInteraction }),
    });
    expect(
      (
        await resolveInteraction(
          resolveRequest(identity.ownerToken),
          resolveParams(episode.id, interaction.id)
        )
      ).status
    ).toBe(404);
    expect(
      (await instance.database.interaction.findUniqueOrThrow({ where: { id: interaction.id } }))
        .status
    ).toBe('ANSWERED');
    expect(
      (
        await resolveInteraction(
          resolveRequest(identity.ownerToken),
          resolveParams(ordinary.id, interaction.id)
        )
      ).status
    ).toBe(404);
    expect(
      (
        await resolveInteraction(
          resolveRequest(other.token),
          resolveParams(ordinary.id, ordinaryInteraction.id)
        )
      ).status
    ).toBe(403);
    const resolved = await resolveInteraction(
      resolveRequest(identity.ownerToken),
      resolveParams(ordinary.id, ordinaryInteraction.id)
    );
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({
      id: ordinaryInteraction.id,
      status: 'RESOLVED',
      helpful: true,
    });
    const deleted = await instance.database.episode.create({
      data: {
        userId: identity.ownerId,
        title: 'Deleted episode',
        topic: 'Greeting',
        deletedAt: new Date(),
      },
    });
    await instance.database.script.create({
      data: {
        episodeId: deleted.id,
        markdown: 'DELETED_SECRET',
        turns: [{ speaker: 'HOST', text: 'DELETED_SECRET' }],
      },
    });
    const deletedScript = await GET(
      new NextRequest(`http://localhost/api/v1/episodes/${deleted.id}/script`, {
        headers: { cookie: `sotto_session=${identity.ownerToken}` },
      }),
      { params: Promise.resolve({ episodeId: deleted.id }) }
    );
    expect(deletedScript.status).toBe(404);
    expect(await getEpisodeForDetailPage(deleted.id)).toBeNull();
    expect(await getShareableEpisodeMetadata(deleted.id)).toBeNull();
    const listRequest = (token: string) =>
      new NextRequest('http://localhost/api/v1/episodes', {
        headers: { cookie: `sotto_session=${token}` },
      });
    const ownerList = await listEpisodes(listRequest(identity.ownerToken));
    expect(ownerList.status).toBe(200);
    expect(ownerList.headers.get('cache-control')).toBe('private, no-store');
    const ownerItems = await ownerList.json();
    expect(ownerItems).toHaveLength(1);
    expect(ownerItems[0]).toMatchObject({ id: ordinary.id, tags: [{ tag: { id: tag.id } }] });
    expect(ownerItems[0]).not.toHaveProperty('learningAudioIdentity');
    expect(ownerItems[0]).not.toHaveProperty('assessmentAudioAssessmentId');
    expect(ownerItems[0]).not.toHaveProperty('assessmentAudioSectionId');
    expect(ownerItems[0]).not.toHaveProperty('assessmentAudioOperationId');
    expect(JSON.stringify(ownerItems)).not.toContain('PRIVATE_STORAGE_IDENTITY');
    const otherList = await listEpisodes(listRequest(other.token));
    expect((await otherList.json()).map((item: { id: string }) => item.id)).toEqual([
      otherEpisode.id,
    ]);
    const anonymous = await listEpisodes(new NextRequest('http://localhost/api/v1/episodes'));
    expect(anonymous.status).toBe(401);
    const backend = await captureStorageBackend();
    const stored = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
    const key = `assessment/${randomUUID()}.wav`;
    const reference = await backend.writeBuffer(key, Buffer.from('PRIVATE_AUDIO'), 'audio/wav');
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(stored);
      const scopes = (await captureEpisodeStorage(database, secondEpisode.id)).scopes;
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [{ consumer: `episode:${secondEpisode.id}:audio`, previousReference: null }],
        next: prepareStorageReference({
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          reference,
          localRoutePrefix: '/api/v1/storage',
          target: { backendId: stored.id, binding: stored.binding, key },
          scopes,
        }),
      });
      await database.episode.update({
        where: { id: secondEpisode.id },
        data: { audioUrl: reference },
      });
    });
    for (const token of [identity.ownerToken, other.token]) {
      const object = await getLocalObject(
        new NextRequest(`http://localhost/api/v1/storage/${key}`, {
          headers: { cookie: `sotto_session=${token}` },
        }),
        { params: Promise.resolve({ key: key.split('/') }) }
      );
      expect(object.status).toBe(404);
      expect(await object.text()).not.toContain('PRIVATE_AUDIO');
    }
    const storage = await sottoTransaction(instance.database, (database) =>
      resolveStorageInput(database, { consumer: `episode:${secondEpisode.id}:audio`, reference })
    );
    const range = {
      input: storage.input,
      descriptor: storage.backend.descriptor,
      execution: {
        userId: identity.ownerId,
        authorize: async () => ({ userId: identity.ownerId }),
      },
      start: 0,
      end: 12,
    };
    await expect(readAttributedStorageRange(range)).rejects.toThrow('not authorized');
    const authorized = await readAssessmentAudioRange(range, async (database) => {
      const owned = await database.episode.findFirst({
        where: {
          id: secondEpisode.id,
          userId: identity.ownerId,
          assessmentAudioAssessmentId: secondAssessment.id,
        },
      });
      if (!owned) throw new Error('Assessment audio unavailable');
    });
    expect(authorized?.body.toString()).toBe('PRIVATE_AUDIO');
    await expect(
      readAssessmentAudioRange(range, async () => {
        throw new Error('Assessment access revoked');
      })
    ).rejects.toThrow('Assessment access revoked');
  }, 15000);
});
