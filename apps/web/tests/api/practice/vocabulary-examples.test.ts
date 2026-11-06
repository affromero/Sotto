// @vitest-environment node
import type { Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { vocabularyExamplesResponseSchema } from '@sotto/shared';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';
import { authorizedLearnerExecution } from '../../helpers/runtime/provider-execution';

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
suite('flashcard examples through owned durable generation', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let sessionId: string;
  let cardId: string;
  let courseId: string;
  let route: typeof import('@/app/api/v1/practice/[sessionId]/vocabulary/[cardId]/examples/route');
  let practice: typeof import('@/app/api/v1/practice/[sessionId]/route');
  let runtime: typeof import('@/lib/queue');
  let processor: typeof import('@/workers/interaction.worker');
  let worker: Worker | undefined;
  let providerCalls: string[];
  let hold: (() => Promise<void>) | undefined;
  let rejectReview: boolean;
  let loseConnection: boolean;
  const examples = [
    { sentence: 'Der Bahnhof ist groß.', translation: 'The station is large.' },
    { sentence: 'Wir warten am Bahnhof.', translation: 'We wait at the station.' },
  ];

  beforeAll(async () => {
    const redis = new URL(process.env.SIDEDOOR_TEST_REDIS_URL!);
    if (!['localhost', '127.0.0.1'].includes(redis.hostname) || redis.pathname !== '/15')
      throw new Error('Use disposable Redis database 15');
    redis.pathname = '/14';
    vi.stubEnv('REDIS_URL', redis.toString());
    instance = await createSharedTestInstance('vocab_examples');
    boundary.database = instance.database;
    runtime = await import('@/lib/queue');
    route = await import('@/app/api/v1/practice/[sessionId]/vocabulary/[cardId]/examples/route');
    practice = await import('@/app/api/v1/practice/[sessionId]/route');
    processor = await import('@/workers/interaction.worker');
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'example-test-key');
    identity = await instance.reset();
    await instance.seedAiCredential(identity.ownerId, 'anthropic', 'example-test-key');
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'German' },
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
    const word = await instance.database.learnerVocab.create({
      data: { courseId, lemma: 'Bahnhof', translation: 'station' },
    });
    const { startVocabularyStudy } = await import('@/lib/vocabulary/study-admission');
    const study = await startVocabularyStudy(
      courseId,
      authorizedLearnerExecution(identity.ownerId),
      { requestId: randomUUID(), mode: 'FLASHCARDS', wordIds: [word.id] }
    );
    sessionId = study.sessionId;
    cardId = study.cards[0]!.id;
    providerCalls = [];
    hold = undefined;
    rejectReview = false;
    loseConnection = false;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = await new Request(input, init).text();
      providerCalls.push(body);
      if (hold) await hold();
      if (loseConnection) throw new Error('private-provider-secret');
      const content = body.includes('Independently check both example sentences')
        ? { accurate: !rejectReview, issues: rejectReview ? ['Incorrect meaning'] : [] }
        : { examples };
      return Response.json({
        id: 'example-message',
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
  const params = () => ({ params: Promise.resolve({ sessionId, cardId }) });
  function get(token = identity.ownerToken) {
    return route.GET(
      new NextRequest(`http://localhost:3000/examples`, {
        headers: { cookie: `sotto_session=${token}` },
      }),
      params()
    );
  }
  function post(body: unknown, token = identity.ownerToken) {
    return route.POST(
      new NextRequest(`http://localhost:3000/examples`, {
        method: 'POST',
        headers: {
          cookie: `sotto_session=${token}`,
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
      params()
    );
  }
  async function status() {
    const response = await get();
    expect(response.status).toBe(200);
    return vocabularyExamplesResponseSchema.parse(await response.json());
  }

  it('deduplicates generation, hides translations before rating and retains them afterward', async () => {
    const initial = await status();
    expect(initial.status).toBe('AVAILABLE');
    const other = await identity.household('Other learner');
    expect((await get(other.token)).status).toBe(404);
    expect((await post(initial.request, other.token)).status).toBe(404);
    expect(
      (await Promise.all([post(initial.request), post(initial.request)])).map((r) => r.status)
    ).toEqual([202, 202]);
    worker = runtime.createWorker('interactions', processor.processInteraction, { concurrency: 2 });
    await worker.waitUntilReady();
    await vi.waitFor(async () => expect((await status()).status).toBe('READY'), {
      timeout: 20_000,
      interval: 50,
    });
    expect((await status()).examples).toEqual(
      examples.map((item) => ({ sentence: item.sentence, translation: null }))
    );
    expect(providerCalls).toHaveLength(2);
    expect(await instance.database.learnerReviewEvent.count({ where: { courseId } })).toBe(0);
    const { sottoTransaction } = await import('@/lib/sidedoor/access/state/transaction');
    const { sottoJobOutbox } = await import('@/lib/sidedoor/jobs/core/job-delivery');
    const retained = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(initial.request.operationId)
    );
    expect(JSON.stringify(retained)).not.toContain('Bahnhof');
    expect(JSON.stringify(retained)).not.toContain('station');
    const { actOnVocabularyStudy } = await import('@/lib/vocabulary/study-actions');
    await actOnVocabularyStudy(sessionId, authorizedLearnerExecution(identity.ownerId), {
      action: 'RATE',
      itemId: cardId,
      rating: 'UNKNOWN',
      expectedRevision: 0,
    });
    expect((await status()).examples).toEqual(examples);
    expect(await instance.database.learnerReviewEvent.count({ where: { courseId } })).toBe(1);
  });

  it('prevents deleting a session while its examples are generating', async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    hold = () => waiting;
    const initial = await status();
    expect((await post(initial.request)).status).toBe(202);
    worker = runtime.createWorker('interactions', processor.processInteraction, { concurrency: 2 });
    await worker.waitUntilReady();
    try {
      await vi.waitFor(() => expect(providerCalls.length).toBeGreaterThan(0), { timeout: 20_000 });
      const response = await practice.DELETE(
        new NextRequest('http://localhost:3000/practice', {
          method: 'DELETE',
          headers: {
            cookie: `sotto_session=${identity.ownerToken}`,
            origin: 'http://localhost:3000',
          },
        }),
        { params: Promise.resolve({ sessionId }) }
      );
      expect(response.status).toBe(409);
    } finally {
      release();
    }
    await vi.waitFor(async () => expect((await status()).status).toBe('READY'), {
      timeout: 20_000,
      interval: 50,
    });
    const deleted = await practice.DELETE(
      new NextRequest('http://localhost:3000/practice', {
        method: 'DELETE',
        headers: {
          cookie: `sotto_session=${identity.ownerToken}`,
          origin: 'http://localhost:3000',
        },
      }),
      { params: Promise.resolve({ sessionId }) }
    );
    expect(deleted.status).toBe(200);
    expect(
      await instance.database.flashcardExample.count({ where: { practiceSessionId: sessionId } })
    ).toBe(0);
  });

  it('retries only a confirmed review failure using a new durable request', async () => {
    rejectReview = true;
    const initial = await status();
    expect((await post(initial.request)).status).toBe(202);
    worker = runtime.createWorker('interactions', processor.processInteraction, { concurrency: 2 });
    await worker.waitUntilReady();
    await vi.waitFor(async () => expect((await status()).status).toBe('FAILED'), {
      timeout: 20_000,
      interval: 50,
    });
    const failed = await status();
    expect(failed.canRetry).toBe(true);
    expect(failed.request.retryOf).toBe(initial.request.operationId);
    rejectReview = false;
    expect((await post(failed.request)).status).toBe(202);
    await vi.waitFor(async () => expect((await status()).status).toBe('READY'), {
      timeout: 20_000,
      interval: 50,
    });
    expect(providerCalls).toHaveLength(4);
  });

  it('does not retry an uncertain provider outcome or expose its error text', async () => {
    loseConnection = true;
    const initial = await status();
    expect((await post(initial.request)).status).toBe(202);
    worker = runtime.createWorker('interactions', processor.processInteraction, { concurrency: 2 });
    await worker.waitUntilReady();
    await vi.waitFor(async () => expect((await status()).status).toBe('FAILED'), {
      timeout: 20_000,
      interval: 50,
    });
    const failed = await status();
    expect(failed.canRetry).toBe(false);
    expect(JSON.stringify(failed)).not.toContain('private-provider-secret');
    expect((await post(failed.request)).status).toBe(409);
  });
});
