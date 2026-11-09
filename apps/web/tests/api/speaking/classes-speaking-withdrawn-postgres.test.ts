// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null, userId: '' }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: async () => ({ userId: boundary.userId }),
}));
vi.mock('@/lib/queue', () => ({ speakingGradingQueue: {} }));

import { GET } from '@/app/api/v1/classes/[classId]/speaking/[promptId]/route';

describe.skipIf(!process.env.SIDEDOOR_TEST_DATABASE_URL)('saved class speaking recordings', () => {
  let instance: SharedTestInstance;
  beforeAll(async () => {
    instance = await createSharedTestInstance('speaking_withdrawn');
    boundary.database = instance.database;
  });
  afterAll(async () => {
    await instance?.close();
  });

  it('preserves historical recordings while excluding withdrawn repair output', async () => {
    const identity = await instance.reset();
    boundary.userId = identity.ownerId;
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'ru' } },
      create: { nativeLang: 'es', targetLang: 'ru', title: 'Fixture' },
      update: {},
    });
    const lesson = await instance.database.lesson.create({
      data: {
        curriculumId: curriculum.id,
        slug: randomUUID(),
        level: 'A1',
        order: 1,
        title: 'First',
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
      data: { courseId: course.id, lessonId: lesson.id, order: 1, status: 'IN_PROGRESS' },
    });
    const makeRecording = async (attempt: number, withdrawn: boolean) => {
      const section = await instance.database.classSection.create({
        data: {
          classId: cls.id,
          skill: 'SPEAKING',
          attempt,
          withdrawn,
          seed: randomUUID(),
          spec: {},
        },
      });
      const prompt = await instance.database.speakingPrompt.create({
        data: { sectionId: section.id, order: 1, targetPhrase: 'Привет', translation: 'Hola' },
      });
      const recording = await instance.database.speakingRecording.create({
        data: {
          sectionId: section.id,
          promptId: prompt.id,
          userId: identity.ownerId,
          audioUrl: '/fixture.webm',
          status: 'SCORED',
          transcript: 'Привет',
          attempt,
        },
      });
      return { prompt, recording };
    };
    const historical = await makeRecording(1, false);
    await makeRecording(2, false);
    const hidden = await makeRecording(3, true);
    const poll = (item: typeof historical) =>
      GET(
        new NextRequest(
          `http://localhost/api/v1/classes/${cls.id}/speaking/${item.prompt.id}?recordingId=${item.recording.id}`
        ),
        { params: Promise.resolve({ classId: cls.id, promptId: item.prompt.id }) }
      );
    const visible = await poll(historical);
    expect(visible.status).toBe(200);
    expect(await visible.json()).toMatchObject({ transcript: 'Привет' });
    expect((await poll(hidden)).status).toBe(404);
    boundary.userId = randomUUID();
    expect((await poll(historical)).status).toBe(404);
    expect(
      await instance.database.speakingRecording.findUnique({ where: { id: hidden.recording.id } })
    ).not.toBeNull();
  });
});
