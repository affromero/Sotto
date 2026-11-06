// @vitest-environment node
import type { Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { vocabularyRefillResponseSchema } from '@sotto/shared';
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
suite('automatic vocabulary replenishment', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let courseId: string;
  let route: typeof import('@/app/api/v1/courses/[courseId]/vocabulary/refill/route');
  let runtime: typeof import('@/lib/queue');
  let processor: typeof import('@/workers/interaction.worker');
  let worker: Worker | undefined;
  let providerCalls: string[];
  let loseConnection: boolean;
  let generationNumber: number;
  const words = [
    { lemma: 'Haus', meaning: 'house', partOfSpeech: 'noun' },
    { lemma: 'Bahnhof', meaning: 'station', partOfSpeech: 'noun' },
    { lemma: 'Wasser', meaning: 'water', partOfSpeech: 'noun' },
    { lemma: 'Freund', meaning: 'friend', partOfSpeech: 'noun' },
  ];
  beforeAll(async () => {
    const redis = new URL(process.env.SIDEDOOR_TEST_REDIS_URL!);
    if (!['localhost', '127.0.0.1'].includes(redis.hostname) || redis.pathname !== '/15')
      throw new Error('Use disposable Redis database 15');
    redis.pathname = '/14';
    vi.stubEnv('REDIS_URL', redis.toString());
    instance = await createSharedTestInstance('vocab_refill');
    boundary.database = instance.database;
    runtime = await import('@/lib/queue');
    processor = await import('@/workers/interaction.worker');
    route = await import('@/app/api/v1/courses/[courseId]/vocabulary/refill/route');
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'refill-test-key');
    identity = await instance.reset();
    await instance.seedAiCredential(identity.ownerId, 'anthropic', 'refill-test-key');
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
    providerCalls = [];
    loseConnection = false;
    generationNumber = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = await new Request(input, init).text();
      providerCalls.push(body);
      if (loseConnection) throw new Error('private-provider-secret');
      const content = body.includes('Independently check the proposed')
        ? { accurate: true, issues: [] }
        : {
            words: words.map((word) => ({
              ...word,
              lemma: `${word.lemma}${generationNumber || ''}`,
            })),
          };
      return Response.json({
        id: 'refill-message',
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
  const params = () => ({ params: Promise.resolve({ courseId }) });
  function get(sessionId?: string, token = identity.ownerToken) {
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
    return route.GET(
      new NextRequest(`http://localhost:3000/refill${query}`, {
        headers: { cookie: `sotto_session=${token}` },
      }),
      params()
    );
  }
  function post(body: unknown, token = identity.ownerToken) {
    return route.POST(
      new NextRequest('http://localhost:3000/refill', {
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
  async function status(sessionId?: string) {
    const response = await get(sessionId);
    expect(response.status).toBe(200);
    return vocabularyRefillResponseSchema.parse(await response.json());
  }
  async function startWorker() {
    worker = runtime.createWorker('interactions', processor.processInteraction, { concurrency: 2 });
    await worker.waitUntilReady();
  }

  it('replenishes an empty dictionary once and creates a replayable next flashcard session', async () => {
    const initial = await status();
    expect(initial.status).toBe('AVAILABLE');
    const other = await identity.household('Other learner');
    expect((await get(undefined, other.token)).status).toBe(404);
    const responses = await Promise.all([post(initial.request), post(initial.request)]);
    expect(responses.every((response) => [200, 202].includes(response.status))).toBe(true);
    await startWorker();
    await vi.waitFor(async () => expect((await status()).status).toBe('READY'), {
      timeout: 20_000,
      interval: 50,
    });
    const ready = await status();
    expect(ready.wordIds).toHaveLength(4);
    await instance.database.vocabularyRefill.update({
      where: { courseId },
      data: { status: 'PUBLISHING' },
    });
    expect((await status()).status).toBe('READY');
    expect(
      (await instance.database.vocabularyRefill.findUniqueOrThrow({ where: { courseId } })).status
    ).toBe('READY');
    expect(providerCalls).toHaveLength(2);
    const dictionary = await instance.database.learnerVocab.findMany({ where: { courseId } });
    expect(dictionary).toHaveLength(4);
    expect(
      dictionary.every(
        (word) => word.introducedAt === null && word.lastReviewed === null && word.reps === 0
      )
    ).toBe(true);
    const { startVocabularyStudy } = await import('@/lib/vocabulary/study-admission');
    const input = { requestId: ready.nextSessionId!, mode: 'FLASHCARDS', wordIds: ready.wordIds! };
    const session = await startVocabularyStudy(
      courseId,
      authorizedLearnerExecution(identity.ownerId),
      input
    );
    const retry = await startVocabularyStudy(
      courseId,
      authorizedLearnerExecution(identity.ownerId),
      input
    );
    expect(retry.sessionId).toBe(session.sessionId);
    expect(session.cards).toHaveLength(4);
    const { actOnVocabularyStudy } = await import('@/lib/vocabulary/study-actions');
    let revision = session.progressRevision;
    for (const card of session.cards) {
      const rated = await actOnVocabularyStudy(
        session.sessionId,
        authorizedLearnerExecution(identity.ownerId),
        { action: 'RATE', itemId: card.id, rating: 'UNKNOWN', expectedRevision: revision }
      );
      revision = rated.progressRevision;
    }
    await actOnVocabularyStudy(session.sessionId, authorizedLearnerExecution(identity.ownerId), {
      action: 'COMPLETE',
      expectedRevision: revision,
    });
    const secondRequest = await status(session.sessionId);
    expect(secondRequest.status).toBe('AVAILABLE');
    generationNumber = 1;
    expect((await post(secondRequest.request)).status).toBe(202);
    expect(['PENDING', 'READY']).toContain((await status(session.sessionId)).status);
    await vi.waitFor(async () => expect((await status(session.sessionId)).status).toBe('READY'), {
      timeout: 20_000,
      interval: 50,
    });
    const second = await status(session.sessionId);
    const next = await startVocabularyStudy(
      courseId,
      authorizedLearnerExecution(identity.ownerId),
      {
        requestId: second.nextSessionId!,
        mode: 'FLASHCARDS',
        wordIds: second.wordIds!,
      }
    );
    revision = next.progressRevision;
    for (const card of next.cards) {
      const rated = await actOnVocabularyStudy(
        next.sessionId,
        authorizedLearnerExecution(identity.ownerId),
        {
          action: 'RATE',
          itemId: card.id,
          rating: 'KNOWN',
          expectedRevision: revision,
        }
      );
      revision = rated.progressRevision;
    }
    await actOnVocabularyStudy(next.sessionId, authorizedLearnerExecution(identity.ownerId), {
      action: 'COMPLETE',
      expectedRevision: revision,
    });
    expect((await status(next.sessionId)).status).toBe('AVAILABLE');
  });

  it('does not dispatch when unseen words are already available', async () => {
    await instance.database.learnerVocab.create({
      data: { courseId, lemma: 'Haus', translation: 'house' },
    });
    expect((await status()).status).toBe('NOT_NEEDED');
    expect(providerCalls).toEqual([]);
  });

  it('does not treat a different manual selection as a generated continuation', async () => {
    const initial = await status();
    expect((await post(initial.request)).status).toBe(202);
    await startWorker();
    await vi.waitFor(async () => expect((await status()).status).toBe('READY'), {
      timeout: 20_000,
      interval: 50,
    });
    const ready = await status();
    const { startVocabularyStudy } = await import('@/lib/vocabulary/study-admission');
    const { actOnVocabularyStudy } = await import('@/lib/vocabulary/study-actions');
    const session = await startVocabularyStudy(
      courseId,
      authorizedLearnerExecution(identity.ownerId),
      {
        requestId: ready.nextSessionId!,
        mode: 'FLASHCARDS',
        wordIds: [ready.wordIds![0]!],
      }
    );
    const rated = await actOnVocabularyStudy(
      session.sessionId,
      authorizedLearnerExecution(identity.ownerId),
      {
        action: 'RATE',
        itemId: session.cards[0]!.id,
        rating: 'UNKNOWN',
        expectedRevision: session.progressRevision,
      }
    );
    await actOnVocabularyStudy(session.sessionId, authorizedLearnerExecution(identity.ownerId), {
      action: 'COMPLETE',
      expectedRevision: rated.progressRevision,
    });
    expect((await status(session.sessionId)).status).toBe('NOT_NEEDED');
  });

  it('keeps legacy reviewed words and makes fresh words available despite a weak frontier', async () => {
    const existing = await instance.database.learnerVocab.create({
      data: {
        courseId,
        lemma: 'Haus',
        translation: 'home',
        introducedAt: null,
        lastReviewed: new Date('2026-01-01T00:00:00Z'),
        reps: 0,
        mastery: 0,
      },
    });
    const { startVocabularyStudy } = await import('@/lib/vocabulary/study-admission');
    const { actOnVocabularyStudy } = await import('@/lib/vocabulary/study-actions');
    const first = await startVocabularyStudy(
      courseId,
      authorizedLearnerExecution(identity.ownerId),
      { requestId: randomUUID(), mode: 'FLASHCARDS' }
    );
    const rated = await actOnVocabularyStudy(
      first.sessionId,
      authorizedLearnerExecution(identity.ownerId),
      { action: 'RATE', itemId: first.cards[0]!.id, rating: 'UNKNOWN', expectedRevision: 0 }
    );
    await actOnVocabularyStudy(first.sessionId, authorizedLearnerExecution(identity.ownerId), {
      action: 'COMPLETE',
      expectedRevision: rated.progressRevision,
    });
    const before = await instance.database.learnerVocab.findUniqueOrThrow({
      where: { id: existing.id },
    });
    const initial = await status(first.sessionId);
    expect(initial.status).toBe('AVAILABLE');
    expect((await post(initial.request)).status).toBe(202);
    await startWorker();
    await vi.waitFor(async () => expect((await status(first.sessionId)).status).toBe('READY'), {
      timeout: 20_000,
      interval: 50,
    });
    const ready = await status(first.sessionId);
    expect(ready.added).toBe(3);
    expect(
      await instance.database.learnerVocab.findUniqueOrThrow({ where: { id: existing.id } })
    ).toEqual(before);
    const next = await startVocabularyStudy(
      courseId,
      authorizedLearnerExecution(identity.ownerId),
      { requestId: ready.nextSessionId!, mode: 'FLASHCARDS', wordIds: ready.wordIds! }
    );
    expect(next.cards.map((card) => card.prompt)).toEqual(
      expect.arrayContaining(['Bahnhof', 'Wasser', 'Freund'])
    );
    expect(next.cards.map((card) => card.prompt)).not.toContain('Haus');
  });

  it('settles a changed course level before dispatch and allows a deliberate retry', async () => {
    const initial = await status();
    expect((await post(initial.request)).status).toBe(202);
    await instance.database.course.update({
      where: { id: courseId },
      data: { currentLevel: 'B1' },
    });
    await startWorker();
    await vi.waitFor(async () => expect((await status()).status).toBe('FAILED'), {
      timeout: 20_000,
      interval: 50,
    });
    const failed = await status();
    expect(failed.canRetry).toBe(true);
    expect(providerCalls).toEqual([]);
  });

  it('does not repeat a provider call whose outcome is uncertain', async () => {
    loseConnection = true;
    const initial = await status();
    expect((await post(initial.request)).status).toBe(202);
    await startWorker();
    await vi.waitFor(async () => expect((await status()).status).toBe('FAILED'), {
      timeout: 20_000,
      interval: 50,
    });
    const failed = await status();
    expect(failed.canRetry).toBe(false);
    expect(JSON.stringify(failed)).not.toContain('private-provider-secret');
  });
});
