// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import type { PrismaClient } from '@/generated/prisma/client';
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

import { POST, GET } from '@/app/api/v1/classes/[classId]/pencil/route';
import { processPencilHomework } from '@/workers/pencil/pencil-homework.worker';
import { pencilHomeworkQueue } from '@/lib/queue';
import { closeRedis } from '@/lib/redis';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite(
  'Pencil interpretation through admission, queue, provider and private durable results',
  () => {
    let instance: SharedTestInstance;
    let identity: SharedTestIdentity;
    let classId: string;
    let taskId: string;
    let image: string;
    let providerRequests: string[];
    const proposal = {
      selectedIndex: 1,
      text: null,
      observations: ['The learner circled option two.'],
      uncertainties: [],
    };
    beforeAll(async () => {
      instance = await createSharedTestInstance('pencil_homework');
      boundary.database = instance.database;
      const png = await sharp({
        create: { width: 800, height: 900, channels: 3, background: 'white' },
      })
        .png()
        .toBuffer();
      image = 'data:image/png;base64,' + png.toString('base64');
    });
    beforeEach(async () => {
      vi.stubEnv('SELF_HOSTED', 'true');
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
      vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
      vi.stubEnv('BYOK_ENCRYPTION_KEY', 'pencil-test-encryption-key');
      identity = await instance.reset();
      await instance.seedAiCredential(identity.ownerId, 'anthropic', 'pencil-test-key');
      const curriculum = await instance.database.curriculum.upsert({
        where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
        create: { nativeLang: 'en', targetLang: 'de', title: 'German' },
        update: {},
      });
      const lesson = await instance.database.lesson.upsert({
        where: { curriculumId_slug: { curriculumId: curriculum.id, slug: 'past-events' } },
        create: {
          curriculumId: curriculum.id,
          slug: 'past-events',
          level: 'A2',
          order: 1,
          title: 'Past events',
          objective: 'Describe completed events',
          grammarPoints: [],
          targetVocab: [],
          vocabThemes: [],
        },
        update: {},
      });
      const course = await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          curriculumId: curriculum.id,
          nativeLang: 'en',
          targetLang: 'de',
        },
      });
      const cls = await instance.database.courseClass.create({
        data: { courseId: course.id, lessonId: lesson.id, order: 1, status: 'AVAILABLE' },
      });
      classId = cls.id;
      const section = await instance.database.classSection.create({
        data: { classId, skill: 'GRAMMAR', status: 'READY', seed: 'pencil', spec: {} },
      });
      const question = await instance.database.lessonQuestion.create({
        data: {
          sectionId: section.id,
          order: 1,
          skill: 'GRAMMAR',
          question: 'Choose the past tense.',
          options: ['machen', 'gemacht'],
          correctIndex: 1,
          explanation: 'Past participle.',
        },
      });
      taskId = question.id;
      providerRequests = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        providerRequests.push(await request.text());
        return Response.json({
          id: 'test-message',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: JSON.stringify(proposal) }],
          model: 'claude-sonnet-4-6',
          stop_reason: 'end_turn',
          usage: { input_tokens: 20, output_tokens: 30 },
        });
      });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });
    afterAll(async () => {
      await pencilHomeworkQueue.close();
      await closeRedis();
      await instance?.close();
      boundary.database = null;
    });
    const params = () => ({ params: Promise.resolve({ classId }) });
    function request(
      operationId: string = randomUUID(),
      token = identity.ownerToken,
      override = {}
    ) {
      return new NextRequest(`http://localhost:3000/api/v1/classes/${classId}/pencil`, {
        method: 'POST',
        headers: {
          cookie: `sotto_session=${token}`,
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          requestId: operationId,
          attempt: 1,
          taskKind: 'QUESTION',
          taskId,
          image,
          ...override,
        }),
      });
    }
    function poll(id: string, token = identity.ownerToken) {
      return GET(
        new NextRequest(
          `http://localhost:3000/api/v1/classes/${classId}/pencil?operationId=${id}`,
          { headers: { cookie: `sotto_session=${token}` } }
        ),
        params()
      );
    }
    async function queued(id: string) {
      const job = await pencilHomeworkQueue.getJob(id);
      if (!job) throw new Error('Expected the admitted interpretation in Redis.');
      return job;
    }
    it('retains a reviewed proposal without grading or completing the class and does not replay a delivery', async () => {
      const id = randomUUID();
      const response = await POST(request(id), params());
      expect(response.status).toBe(202);
      expect(await (await poll(id)).json()).toEqual({ status: 'PENDING', operationId: id });
      await processPencilHomework(await queued(id));
      expect(await (await poll(id)).json()).toEqual({ status: 'READY', operationId: id, proposal });
      const originalRequests = [...providerRequests];
      expect(originalRequests.length).toBeGreaterThan(0);
      expect(originalRequests.join('\n')).toContain(image.split(',')[1]);
      expect(originalRequests.join('\n')).not.toContain('correctIndex');
      await processPencilHomework(await queued(id));
      expect(providerRequests).toEqual(originalRequests);
      expect(await instance.database.classSubmission.count()).toBe(0);
      expect(await instance.database.writingResponse.count()).toBe(0);
      expect(
        (await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } })).status
      ).toBe('AVAILABLE');
    });
    it('reuses a request identity but rejects a different image or class attempt under it', async () => {
      const id = randomUUID();
      expect((await POST(request(id), params())).status).toBe(202);
      expect((await POST(request(id), params())).status).toBe(202);
      expect((await POST(request(id, identity.ownerToken, { attempt: 2 }), params())).status).toBe(
        409
      );
    });

    it('accepts the uppercase UUID format sent by the native app', async () => {
      const id = randomUUID().toUpperCase();
      expect((await POST(request(id), params())).status).toBe(202);
      await processPencilHomework(await queued(id));
      expect(await (await poll(id)).json()).toEqual({ status: 'READY', operationId: id, proposal });
    });
    it('keeps outcomes private and refuses results after class regeneration', async () => {
      const id = randomUUID();
      expect((await POST(request(id), params())).status).toBe(202);
      await processPencilHomework(await queued(id));
      const other = await identity.household('Other learner');
      expect((await poll(id, other.token)).status).toBe(404);
      await instance.database.courseClass.update({ where: { id: classId }, data: { attempt: 2 } });
      expect((await poll(id)).status).toBe(409);
    });
    it('retains provider failure after Redis cleanup and never repeats an uncertain paid request', async () => {
      const id = randomUUID();
      expect((await POST(request(id), params())).status).toBe(202);
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        providerRequests.push(await new Request(input, init).text());
        throw new Error('Connection lost after dispatch');
      });
      await expect(processPencilHomework(await queued(id))).rejects.toThrow();
      const requestsAfterFailure = [...providerRequests];
      const job = await queued(id);
      await job.remove();
      const result = await (await poll(id)).json();
      expect(result.status).toBe('FAILED');
      expect(result.error).toMatch(/unconfirmed|unresolved/);
      expect((await POST(request(id), params())).status).toBeGreaterThanOrEqual(400);
      expect(providerRequests).toEqual(requestsAfterFailure);
    });
  }
);
