// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { GET as quiz, POST as submit } from '@/app/api/v1/placement/route';
import { createWorker, placementGenerationQueue } from '@/lib/queue';
import { closeRedis } from '@/lib/redis';
import { processPlacementGeneration } from '@/lib/placement/processing';
import { getServerInfra } from '@/lib/server-config';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox, deliverSottoJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import { durableQueueOperationId } from '@/lib/sidedoor/jobs/core/durable-queue';
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
vi.mock('openai', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(`${process.cwd()}/package.json`)('openai') };
});
const responseSchema = z.object({
  placementSessionId: z.uuid(),
  status: z.string(),
  questionsDigest: z.string(),
  questions: z.array(z.object({ id: z.string(), options: z.array(z.string()) })),
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('queued private placement with real HTTP and Redis', () => {
  let instance: SharedTestInstance,
    identity: SharedTestIdentity,
    directory: string,
    server: Server,
    endpoint: string;
  let providerRequests = 0,
    unknown = false;
  const jobs = new Set<string>();
  const fixtureErrors: unknown[] = [];
  beforeAll(async () => {
    instance = await createSharedTestInstance('placement_worker_http');
    boundary.database = instance.database;
    directory = await mkdtemp(join(tmpdir(), 'sotto-placement-worker-'));
    server = createServer(async (request, response) => {
      try {
        if (request.method !== 'POST' || request.url !== '/v1/chat/completions')
          throw new Error('Unexpected synthetic provider path.');
        const parts: Buffer[] = [];
        for await (const chunk of request) parts.push(Buffer.from(chunk));
        const body = z
          .object({ model: z.string() })
          .parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
        providerRequests++;
        if (unknown) {
          request.socket.destroy();
          return;
        }
        const questions = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].flatMap((cefr) =>
          Array.from({ length: 4 }, (_, index) => ({
            cefr,
            skill: index % 2 ? 'reading' : 'grammar',
            prompt: `Owned ${cefr} question ${index}`,
            options: ['Correct', 'Other one', 'Other two', 'Other three'],
            correctIndex: 0,
            explanation: 'The selected construction fits the synthetic context.',
          }))
        );
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            id: 'synthetic-quiz-response',
            object: 'chat.completion',
            created: 1,
            model: body.model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: JSON.stringify({ questions }) },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          })
        );
      } catch (error) {
        fixtureErrors.push(error);
        response.writeHead(500);
        response.end('Synthetic placement provider failed.');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing synthetic provider address.');
    endpoint = `http://127.0.0.1:${address.port}/v1`;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(directory, 'executions'));
    identity = await instance.reset();
    providerRequests = 0;
    unknown = false;
    await instance.configureInfrastructure({
      ...(await getServerInfra()),
      aiProvider: 'local',
      aiModel: 'local:synthetic-placement',
      aiBaseUrl: endpoint,
    });
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: { preferredAiProvider: 'local', preferredAiModel: 'local:synthetic-placement' },
    });
    await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Owned quiz curriculum' },
      update: {},
    });
  });
  afterEach(async () => {
    await instance.database.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS synthetic_quiz_publication ON "PlacementSession"'
    );
    await instance.database.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS synthetic_quiz_publication()'
    );
    for (const id of jobs) await (await placementGenerationQueue.getJob(id))?.remove();
    jobs.clear();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await placementGenerationQueue.close();
    await closeRedis();
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    boundary.database = null;
    await instance?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    expect(fixtureErrors).toEqual([]);
  });
  function request(query = '', body?: unknown, token = identity.ownerToken) {
    return new NextRequest(`http://localhost:3000/api/v1/placement${query}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        cookie: `sotto_session=${token}`,
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function admitted() {
    const response = await quiz(request(`?native=en&target=de&requestId=${randomUUID()}`));
    expect(response.status).toBe(202);
    return responseSchema.parse(await response.json());
  }
  async function delivered(sessionId: string) {
    const operationId = durableQueueOperationId(
      'placement-generation',
      `placement-generation-${sessionId}`
    );
    jobs.add(operationId);
    const work = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operationId)
    );
    if (!work) throw new Error('Missing quiz outbox.');
    await deliverSottoJob({
      database: instance.database,
      queue: placementGenerationQueue,
      operationId,
      fingerprint: work.fingerprint,
      version: 1,
    });
    const job = await placementGenerationQueue.getJob(operationId);
    if (!job) throw new Error('Missing delivered quiz.');
    return job;
  }
  it('publishes an owned quiz once and confirms the exact question receipt without awarding objective mastery', async () => {
    const admittedQuiz = await admitted();
    const job = await delivered(admittedQuiz.placementSessionId);
    const worker = createWorker('placement-generation', processPlacementGeneration, {
      concurrency: 1,
    });
    try {
      await vi.waitFor(async () => expect(await job.getState()).toBe('completed'), {
        timeout: 15_000,
      });
    } finally {
      await worker.close();
    }
    const response = await quiz(request(`?placementSessionId=${admittedQuiz.placementSessionId}`));
    const body: unknown = await response.json();
    expect(JSON.stringify(body)).not.toContain('correctIndex');
    const ready = responseSchema.parse(body);
    expect(ready.status).toBe('READY');
    expect(ready.questions).toHaveLength(24);
    expect(ready.questions.every((question) => question.options.length === 5)).toBe(true);
    const intent = {
      schemaVersion: 1,
      requestId: randomUUID(),
      native: 'en',
      target: 'de',
      placementSessionId: ready.placementSessionId,
      questionsDigest: ready.questionsDigest,
      answers: ready.questions.map((question) => ({ id: question.id, selectedIndex: 0 })),
    };
    const accepted = await submit(request('', intent));
    expect(accepted.status).toBe(200);
    const confirmation: unknown = await accepted.json();
    expect(await (await submit(request('', intent))).json()).toEqual(confirmation);
    expect(providerRequests).toBe(1);
    expect(await instance.database.learningObservation.count()).toBe(0);
    expect(await instance.database.learningLevelCompletion.count()).toBe(0);
    expect(await instance.database.learningLevelBinding.count()).toBe(1);
  });
  it('replays an already saved successful quiz response after a publication crash and configuration change', async () => {
    const admittedQuiz = await admitted(),
      job = await delivered(admittedQuiz.placementSessionId);
    await instance.database.$executeRawUnsafe(
      `CREATE FUNCTION synthetic_quiz_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'READY' THEN RAISE EXCEPTION 'Synthetic quiz publication crash'; END IF; RETURN NEW; END $$`
    );
    await instance.database.$executeRawUnsafe(
      'CREATE TRIGGER synthetic_quiz_publication BEFORE UPDATE ON "PlacementSession" FOR EACH ROW EXECUTE FUNCTION synthetic_quiz_publication()'
    );
    await expect(processPlacementGeneration(job)).rejects.toThrow(
      'Synthetic quiz publication crash'
    );
    expect(
      (
        await instance.database.placementSession.findUniqueOrThrow({
          where: { id: admittedQuiz.placementSessionId },
        })
      ).status
    ).toBe('SUCCEEDED');
    await instance.database.$executeRawUnsafe(
      'DROP TRIGGER synthetic_quiz_publication ON "PlacementSession"'
    );
    await instance.configureInfrastructure({
      ...(await getServerInfra()),
      aiBaseUrl: 'http://127.0.0.1:1/v1',
    });
    await processPlacementGeneration(job);
    expect(
      (
        await instance.database.placementSession.findUniqueOrThrow({
          where: { id: admittedQuiz.placementSessionId },
        })
      ).status
    ).toBe('READY');
    expect(providerRequests).toBe(1);
  });
  it('retains unknown provider outcome and blocks equivalent generation under a new request ID', async () => {
    unknown = true;
    const admittedQuiz = await admitted(),
      job = await delivered(admittedQuiz.placementSessionId);
    const worker = createWorker('placement-generation', processPlacementGeneration, {
      concurrency: 1,
    });
    try {
      await vi.waitFor(async () => expect(await job.getState()).toBe('failed'), {
        timeout: 20_000,
      });
    } finally {
      await worker.close();
    }
    expect(
      (
        await instance.database.placementSession.findUniqueOrThrow({
          where: { id: admittedQuiz.placementSessionId },
        })
      ).status
    ).toBe('RECOVERY_REQUIRED');
    expect((await quiz(request(`?native=en&target=de&requestId=${randomUUID()}`))).status).toBe(
      409
    );
    const foreign = await identity.household('Foreign quiz learner');
    expect(
      (
        await quiz(
          request(
            `?placementSessionId=${admittedQuiz.placementSessionId}`,
            undefined,
            foreign.token
          )
        )
      ).status
    ).toBe(404);
    expect(providerRequests).toBe(1);
  }, 30_000);
});
