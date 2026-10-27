// @vitest-environment node
import type { Worker } from 'bullmq';
import filesystem from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { classLessonHelpResponseSchema, type ClassLessonHelpResponse } from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';
import { teaching } from '../../../components/learn/lesson/teaching-fixture';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});

const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SIDEDOOR_TEST_REDIS_URL
    ? describe
    : describe.skip;

suite('optional lesson help through HTTP admission and the real interactions worker', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let classId: string;
  let runtime: typeof import('@/lib/queue');
  let route: typeof import('@/app/api/v1/classes/[classId]/lesson-help/route');
  let processor: typeof import('@/workers/interaction.worker');
  let worker: Worker | undefined;
  let providerRequests: string[];
  let rejectFidelity: boolean;
  let loseConnection: boolean;
  let holdResponse: (() => Promise<void>) | undefined;
  const source = {
    ...teaching,
    guidedPractice: {
      ...teaching.guidedPractice,
      answer: 'CONCEALED_GUIDED_ANSWER',
      explanation: 'CONCEALED_GUIDED_EXPLANATION',
    },
  };
  const help = {
    title: 'Talk about yesterday',
    explanation: 'Describe completed events with the perfect tense.',
    workedExamples: [
      {
        prompt: 'Describe the visit.',
        meaning: 'I visited the museum.',
        explanation: 'Use haben.',
      },
      { prompt: 'Describe the journey.', meaning: 'I went to Berlin.', explanation: 'Use sein.' },
    ],
    correctionExplanation: 'Use sein for this journey.',
    guidedPrompt: 'Describe your completed visit.',
    guidedHint: 'Choose the auxiliary first.',
  };

  beforeAll(async () => {
    const url = new URL(process.env.SIDEDOOR_TEST_REDIS_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use disposable local Redis database 15');
    url.pathname = '/14';
    vi.stubEnv('REDIS_URL', url.toString());
    instance = await createSharedTestInstance('lesson_help');
    boundary.database = instance.database;
    runtime = await import('@/lib/queue');
    route = await import('@/app/api/v1/classes/[classId]/lesson-help/route');
    processor = await import('@/workers/interaction.worker');
  });

  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'lesson-help-test-encryption-key');
    identity = await instance.reset();
    await instance.seedAiCredential(identity.ownerId, 'anthropic', 'lesson-help-test-key');
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
        level: 'B1',
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
      data: {
        courseId: course.id,
        lessonId: lesson.id,
        order: 1,
        status: 'AVAILABLE',
        adaptiveSeed: { teaching: source, assessmentSecret: 'CONCEALED_ASSESSMENT_KEY' },
      },
    });
    classId = cls.id;
    providerRequests = [];
    rejectFidelity = false;
    loseConnection = false;
    holdResponse = undefined;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = await new Request(input, init).text();
      providerRequests.push(body);
      if (holdResponse) await holdResponse();
      if (loseConnection) throw new Error('Connection lost after provider dispatch');
      const content = body.includes('Independently verify native-language support')
        ? {
            accurate: !rejectFidelity,
            nativeLanguageCorrect: true,
            targetExamplesPreserved: true,
            issues: rejectFidelity ? ['Changed meaning.'] : [],
          }
        : help;
      return Response.json({
        id: 'lesson-help-message',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: JSON.stringify(content) }],
        model: 'fixture-model',
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 30 },
      });
    });
  });

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    await runtime.interactionQueue.drain(true);
    await runtime.interactionQueue.clean(0, 100, 'completed');
    await runtime.interactionQueue.clean(0, 100, 'failed');
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await runtime?.interactionQueue.close();
    await (await import('@/lib/redis')).closeRedis();
    await instance?.close();
    boundary.database = null;
    vi.unstubAllEnvs();
  });

  const params = () => ({ params: Promise.resolve({ classId }) });
  function get(token = identity.ownerToken) {
    return route.GET(
      new NextRequest(`http://localhost:3000/api/v1/classes/${classId}/lesson-help`, {
        headers: { cookie: `sotto_session=${token}` },
      }),
      params()
    );
  }
  function post(input: unknown, token = identity.ownerToken, origin = 'http://localhost:3000') {
    return route.POST(
      new NextRequest(`http://localhost:3000/api/v1/classes/${classId}/lesson-help`, {
        method: 'POST',
        headers: { cookie: `sotto_session=${token}`, origin, 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
      params()
    );
  }
  async function status(): Promise<ClassLessonHelpResponse> {
    const response = await get();
    expect(response.status).toBe(200);
    return response.json();
  }
  async function startWorker() {
    worker = runtime.createWorker('interactions', processor.processInteraction, { concurrency: 2 });
    await worker.waitUntilReady();
  }
  async function settled(expected: 'READY' | 'FAILED') {
    let value = await status();
    await vi.waitFor(
      async () => {
        value = await status();
        expect(value.status).toBe(expected);
      },
      { timeout: 15_000, interval: 50 }
    );
    return value;
  }

  it('deduplicates concurrent requests and reopens a saved explanation without changing the class', async () => {
    const before = await instance.database.courseClass.findUniqueOrThrow({
      where: { id: classId },
    });
    const initial = await status();
    expect(initial.status).toBe('AVAILABLE');
    expect(initial.nativeLang).toBe('en');
    expect(initial.targetLang).toBe('de');
    const responses = await Promise.all([post(initial.request), post(initial.request)]);
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    for (const response of responses)
      expect(classLessonHelpResponseSchema.parse(await response.json()).status).toBe('PENDING');
    await startWorker();
    expect((await settled('READY')).help).toEqual(help);
    const paidRequests = [...providerRequests];
    expect(paidRequests).toHaveLength(2);
    expect(paidRequests.join('\n')).toContain(source.workedExamples[0].answer);
    expect(paidRequests.join('\n')).not.toMatch(/CONCEALED_|assessmentSecret/);
    expect((await post(initial.request)).status).toBe(200);
    expect((await status()).help).toEqual(help);
    expect(providerRequests).toEqual(paidRequests);
    expect(
      await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } })
    ).toEqual(before);
    expect(await instance.database.classSubmission.count()).toBe(0);
    expect(await instance.database.writingResponse.count()).toBe(0);
  });

  it('enforces ownership, origin, source attempt and the server-selected native language', async () => {
    const initial = await status();
    const other = await identity.household('Other learner');
    expect((await get(other.token)).status).toBe(404);
    expect((await post(initial.request, other.token)).status).toBe(404);
    expect(
      (await post(initial.request, identity.ownerToken, 'https://untrusted.example')).status
    ).toBe(403);
    expect((await post({ ...initial.request, attempt: 2 })).status).toBe(409);
    expect((await post({ ...initial.request, sourceHash: '0'.repeat(64) })).status).toBe(409);
    expect((await post({ ...initial.request, nativeLang: 'fr' })).status).toBe(400);
    expect(providerRequests).toEqual([]);
  });

  it('refuses stale teaching before provider dispatch', async () => {
    const initial = await status();
    expect((await post(initial.request)).status).toBe(202);
    await instance.database.courseClass.update({ where: { id: classId }, data: { attempt: 2 } });
    await startWorker();
    await vi.waitFor(async () => {
      expect(
        await (await runtime.interactionQueue.getJob(initial.request.operationId))?.getState()
      ).toBe('failed');
    });
    expect(providerRequests).toEqual([]);
    const fresh = await status();
    expect(fresh.status).toBe('AVAILABLE');
    expect(fresh.request.operationId).not.toBe(initial.request.operationId);
    expect((await post(initial.request)).status).toBe(409);
  });

  it('retains an unknown outcome after Redis removal and refuses another paid dispatch', async () => {
    loseConnection = true;
    const initial = await status();
    expect((await post(initial.request)).status).toBe(202);
    await startWorker();
    const failure = await settled('FAILED');
    expect(failure.canRetry).toBe(false);
    expect(failure.error).toMatch(/unconfirmed|recovery/);
    await worker!.close();
    worker = undefined;
    await (await runtime.interactionQueue.getJob(initial.request.operationId))?.remove();
    const dispatched = [...providerRequests];
    expect(dispatched.length).toBeGreaterThan(0);
    expect((await post(initial.request)).status).toBe(409);
    expect((await status()).canRetry).toBe(false);
    expect(providerRequests).toEqual(dispatched);
  });

  it('requires an explicit stable retry after a confirmed fidelity rejection', async () => {
    rejectFidelity = true;
    const initial = await status();
    expect((await post(initial.request)).status).toBe(202);
    await startWorker();
    const failure = await settled('FAILED');
    expect(failure.canRetry).toBe(true);
    expect(failure.help).toBeUndefined();
    expect(failure.request.retryOf).toBe(initial.request.operationId);
    expect(failure.request.operationId).not.toBe(initial.request.operationId);
    expect((await status()).request).toEqual(failure.request);
    rejectFidelity = false;
    const responses = await Promise.all([post(failure.request), post(failure.request)]);
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    expect((await settled('READY')).help).toEqual(help);
    expect(providerRequests).toHaveLength(4);
  });

  it('withholds completed provider output when workspace cleanup is unconfirmed', async () => {
    const initial = await status();
    expect((await post(initial.request)).status).toBe(202);
    const affected = new Set<string>();
    holdResponse = async () => {
      if (providerRequests.length !== 2) return;
      const root = process.env.SIDEDOOR_EXECUTION_DIR!;
      const workspaces = (await filesystem.readdir(root, { withFileTypes: true })).filter(
        (entry) => entry.isDirectory() && entry.name.startsWith('execution-')
      );
      for (const entry of workspaces) {
        const path = join(root, entry.name);
        const original = path + '-original';
        await filesystem.rename(path, original);
        await filesystem.mkdir(path, { mode: 0o700 });
        affected.add(path);
        affected.add(original);
      }
    };
    try {
      await startWorker();
      const failure = await settled('FAILED');
      expect(failure.canRetry).toBe(false);
      expect(failure.help).toBeUndefined();
      expect(failure.error).toMatch(/recovery|unconfirmed/);
      await worker!.close();
      worker = undefined;
      await (await runtime.interactionQueue.getJob(initial.request.operationId))?.remove();
      expect((await post(initial.request)).status).toBe(409);
      expect(providerRequests).toHaveLength(2);
      expect(affected.size).toBeGreaterThan(0);
    } finally {
      for (const path of affected) await filesystem.rm(path, { recursive: true, force: true });
    }
  });

  it('never publishes a result if the saved teaching changes during generation', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    holdResponse = () => pending;
    const initial = await status();
    expect((await post(initial.request)).status).toBe(202);
    await startWorker();
    try {
      await vi.waitFor(() => expect(providerRequests.length).toBeGreaterThan(0));
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { adaptiveSeed: { teaching: { ...source, title: 'Eine neue Erklärung' } } },
      });
    } finally {
      release();
    }
    await vi.waitFor(
      async () => {
        expect(
          await (await runtime.interactionQueue.getJob(initial.request.operationId))?.getState()
        ).toBe('failed');
      },
      { timeout: 10_000 }
    );
    const fresh = await status();
    expect(fresh.status).toBe('AVAILABLE');
    expect(fresh.help).toBeUndefined();
    expect(fresh.request.sourceHash).not.toBe(initial.request.sourceHash);
  });
});
