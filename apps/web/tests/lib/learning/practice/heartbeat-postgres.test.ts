// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Job } from 'bullmq';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';
import { requestPracticePreparation } from '@/lib/practice/preparation';
import {
  requireOriginalSottoAdmission,
  resolveSottoRequest,
} from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { processPracticePreparation } from '@/workers/practice/practice-preparation.worker';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('Practice worker heartbeat lifetime', () => {
  let instance: SharedTestInstance;
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sotto-practice-heartbeat-'));
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(directory, 'executions'));
    instance = await createSharedTestInstance('practice_heartbeat');
    boundary.database = instance.database;
  });
  afterEach(() => {
    boundary.database = instance.database;
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
    await rm(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('keeps the execution active until an in-flight heartbeat drains after generation fails', async () => {
    const identity = await instance.reset();
    await instance.seedAiCredential(identity.ownerId, 'openai', 'heartbeat-fixture-key');
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: {
        preferredAiProvider: 'openai',
        preferredAiModel: getAiProviderMeta('openai').defaultModel,
      },
    });
    const curriculum = await instance.database.curriculum.create({
      data: { nativeLang: 'en', targetLang: 'de', title: 'Heartbeat fixture' },
    });
    const course = await instance.database.course.create({
      data: {
        userId: identity.ownerId,
        nativeLang: 'en',
        targetLang: 'de',
        curriculumId: curriculum.id,
      },
    });
    await instance.database.lesson.create({
      data: {
        curriculumId: curriculum.id,
        slug: 'heartbeat-fixture',
        level: 'A1',
        order: 1,
        title: 'Greetings',
        objective: 'Greet Ana',
        grammarPoints: ['present'],
        targetVocab: [{ lemma: 'Hallo', gloss: 'hello' }],
        vocabThemes: ['greetings'],
      },
    });
    const request = new Request('http://localhost', {
      headers: { cookie: `sotto_session=${identity.ownerToken}` },
    });
    const original = await sottoTransaction(instance.database, (database) =>
      resolveSottoRequest(database, request)
    );
    if (!original || original.kind !== 'content') throw new Error('Missing learner fixture');
    const operation = await requestPracticePreparation(course.id, 'FULL', {
      userId: original.userId,
      signal: request.signal,
      authorize: async (database) => {
        await requireOriginalSottoAdmission(database, request, original);
        return { userId: original.userId };
      },
    });
    const record = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operation.id)
    );
    if (!record) throw new Error('Missing preparation receipt');
    const job = {
      id: operation.id,
      name: 'practice-preparation.v1',
      data: { operationId: operation.id, fingerprint: record.fingerprint },
    } as Job<unknown>;
    const providerStarted = Promise.withResolvers<void>();
    const providerReleased = Promise.withResolvers<void>();
    const heartbeatStarted = Promise.withResolvers<void>();
    const heartbeatReleased = Promise.withResolvers<void>();
    const cleanupStarted = Promise.withResolvers<void>();
    const transactions = new Set<Promise<unknown>>();
    let holdHeartbeat = false;
    boundary.database = new Proxy(instance.database, {
      get(target, property, receiver) {
        if (property !== '$transaction') return Reflect.get(target, property, receiver);
        return (...args: unknown[]) => {
          const begin = () => Reflect.apply(target.$transaction, target, args) as Promise<unknown>;
          const held = holdHeartbeat;
          holdHeartbeat = false;
          const transaction = held ? heartbeatReleased.promise.then(begin) : begin();
          if (held) heartbeatStarted.resolve();
          transactions.add(transaction);
          void transaction.then(
            () => {
              transactions.delete(transaction);
            },
            () => {
              transactions.delete(transaction);
            }
          );
          return transaction;
        };
      },
    });
    vi.stubGlobal('fetch', async () => {
      providerStarted.resolve();
      await providerReleased.promise;
      return Response.json(
        { error: { message: 'Provider rejected the fixture' } },
        { status: 400 }
      );
    });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const clear = globalThis.clearInterval;
    vi.spyOn(globalThis, 'clearInterval').mockImplementation((timer) => {
      clear(timer);
      cleanupStarted.resolve();
    });
    const settled = processPracticePreparation(job).then(
      () => ({ kind: 'finished' as const }),
      (error: unknown) => ({ kind: 'failed' as const, error })
    );
    const observation = new AbortController();
    try {
      expect(
        await Promise.race([
          providerStarted.promise.then(() => ({ kind: 'provider-started' })),
          settled,
        ])
      ).toEqual({ kind: 'provider-started' });
      holdHeartbeat = true;
      vi.advanceTimersByTime(500);
      await heartbeatStarted.promise;
      providerReleased.resolve();
      await cleanupStarted.promise;
      expect(
        await Promise.race([
          settled,
          delay(1_000, { kind: 'pending' }, { signal: observation.signal }),
        ])
      ).toEqual({ kind: 'pending' });
      expect(
        await sottoTransaction(instance.database, (database) =>
          sottoJobExecutions(database).blockingStatus(operation.id, record.fingerprint)
        )
      ).toBe('active');
      heartbeatReleased.resolve();
      expect(await settled).toEqual({ kind: 'finished' });
      expect(
        await sottoTransaction(instance.database, (database) =>
          sottoJobExecutions(database).blockingStatus(operation.id, record.fingerprint)
        )
      ).toBeNull();
      await expect(instance.reset()).resolves.toHaveProperty('ownerId');
    } finally {
      observation.abort();
      providerReleased.resolve();
      heartbeatReleased.resolve();
      await settled;
      while (transactions.size) await Promise.allSettled([...transactions]);
    }
  });
});
