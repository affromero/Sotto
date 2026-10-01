// @vitest-environment node
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  resolveSottoRequest,
  requireOriginalSottoAdmission,
} from '@/lib/sidedoor/access/core/request-identity';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  requestPracticePreparation,
  cancelPracticePreparation,
  readPracticePreparation,
  practicePreparationGrant,
  validatePracticePreparation,
  reconcilePracticePreparation,
} from '@/lib/practice/preparation';
import { learningPreparationProviderRequest } from '@/lib/learning/preparation/preparation-provider';
import { processPracticePreparation } from '@/workers/practice/practice-preparation.worker';
import { resumePractice } from '@/lib/practice/resume';
import { practicePreparingSchema } from '@sotto/shared';
import {
  registerPreparationAudio,
  validatePreparationAudio,
} from '@/lib/classes/preparation-audio';
import {
  captureSottoCredentialOwner,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { setSiteConfig } from '@/lib/site-config';
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

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('Durable practice preparation against PostgreSQL', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let courseId: string;
  let execution: SottoProviderExecution;
  let temporaryRoot: string;

  beforeAll(async () => {
    instance = await createSharedTestInstance('practice_preparation');
    boundary.database = instance.database;
    temporaryRoot = await mkdtemp(join(tmpdir(), 'practice-preparation-test-'));
  });
  beforeEach(async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(temporaryRoot, 'executions'));
    identity = await instance.reset();
    await instance.seedAiCredential(identity.ownerId, 'openai', 'private-practice-fixture-key');
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: {
        preferredAiProvider: 'openai',
        preferredAiModel: getAiProviderMeta('openai').defaultModel,
      },
    });
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Practice fixture' },
      update: {},
    });
    courseId = (
      await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          nativeLang: 'en',
          targetLang: 'de',
          curriculumId: curriculum.id,
        },
      })
    ).id;
    const request = new Request('http://localhost', {
      headers: { cookie: `sotto_session=${identity.ownerToken}` },
    });
    const original = await sottoTransaction(instance.database, (database) =>
      resolveSottoRequest(database, request)
    );
    if (!original || original.kind !== 'content') throw new Error('Expected learner fixture');
    execution = {
      userId: original.userId,
      signal: request.signal,
      authorize: async (database) => {
        await requireOriginalSottoAdmission(database, request, original);
        return { userId: original.userId };
      },
    };
    vi.stubGlobal('fetch', async () => {
      throw new Error('This scenario must not dispatch provider work');
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  async function queuedJob(operationId: string) {
    const record = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operationId)
    );
    if (!record) throw new Error('Missing durable job fixture');
    return {
      id: operationId,
      name: 'practice-preparation.v1',
      data: { operationId, fingerprint: record.fingerprint },
    } as Job<unknown>;
  }
  async function saved(sessionId: string) {
    return sottoTransaction(instance.database, (database) =>
      readPracticePreparation(database, sessionId)
    );
  }

  it('saves requirements, a scoped grant and an outbox receipt before acknowledging a stable request', async () => {
    const requestId = randomUUID();
    const operation = await requestPracticePreparation(courseId, 'FULL', execution, { requestId });
    const replay = await requestPracticePreparation(courseId, 'FULL', execution, { requestId });
    expect(replay.id).toBe(operation.id);
    const { session, generation } = await saved(requestId);
    expect(session.status).toBe('GENERATING');
    expect(generation.requirements.skills.GRAMMAR.state).toBe('REQUIRED');
    expect(generation.requirements.skills.READING.state).toBe('REQUIRED');
    expect(generation.requirements.skills.WRITING.state).toBe('REQUIRED');
    const record = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operation.id)
    );
    expect(record?.job.payload).toEqual({ sessionId: requestId, operationId: operation.id });
    const grant = await sottoTransaction(instance.database, (database) =>
      practicePreparationGrant(database, operation).read(operation.grant)
    );
    expect(grant.grant.resource.id).toBe(`course:${courseId}`);
    expect(grant.grant.action).toBe('practice-parent-provider-request');
    expect(JSON.stringify({ operation, record, grant })).not.toContain(
      'private-practice-fixture-key'
    );
    expect(
      practicePreparingSchema.parse(await resumePractice(requestId, identity.ownerId))
        .preparationStatus
    ).toBe('QUEUED');
    expect(await instance.database.practiceSession.count()).toBe(1);
  });

  it('reports failed generation without inventing a settings diagnosis or exposing private errors', async () => {
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    await instance.database.lesson.upsert({
      where: { curriculumId_slug: { curriculumId: course.curriculumId, slug: 'full-fixture' } },
      update: {},
      create: {
        curriculumId: course.curriculumId,
        slug: 'full-fixture',
        level: 'A1',
        order: 1,
        title: 'Greetings',
        objective: 'Greet Ana and describe where Mia lives',
        grammarPoints: ['present'],
        targetVocab: [{ lemma: 'Hallo', gloss: 'hello' }],
        vocabThemes: ['greetings'],
      },
    });
    const privateError = 'Private provider rejection';
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: { message: privateError } }, { status: 400 })
    );
    const operation = await requestPracticePreparation(courseId, 'FULL', execution);
    await processPracticePreparation(await queuedJob(operation.id));
    expect((await saved(operation.sessionId)).operation).toMatchObject({
      status: 'FAILED',
      failure: 'generation_failed',
    });
    const result = practicePreparingSchema.parse(
      await resumePractice(operation.sessionId, identity.ownerId)
    );
    expect(result.preparationStatus).toBe('FAILED');
    expect(result.message).toMatch(/generation failed/i);
    expect(result.message).toMatch(/new attempt/i);
    expect(result.message).not.toMatch(/provider settings/i);
    expect(JSON.stringify(result)).not.toContain(privateError);
  });

  it('allows independent practice requests and rejects reuse for a different skill or selected focus', async () => {
    const first = await requestPracticePreparation(courseId, 'FULL', execution);
    const second = await requestPracticePreparation(courseId, 'FULL', execution);
    expect(first.sessionId).not.toBe(second.sessionId);
    await expect(
      requestPracticePreparation(courseId, 'GRAMMAR', execution, { requestId: first.sessionId })
    ).rejects.toThrow(/different/);
    await expect(
      requestPracticePreparation(courseId, 'FULL', execution, {
        requestId: first.sessionId,
        focusTargetId: 'another-target',
      })
    ).rejects.toThrow(/different/);
    expect(await instance.database.practiceSession.count()).toBe(2);
  });

  it('retains required listening and rejects a removed provider before queued work can run', async () => {
    await setSiteConfig(
      { ttsProvider: 'local', ttsBaseUrl: 'http://local-tts:8000' },
      identity.ownerId
    );
    const operation = await requestPracticePreparation(courseId, 'FULL', execution);
    await sottoTransaction(instance.database, async (database) => {
      const work = await readPracticePreparation(database, operation.sessionId);
      await database.practiceSession.update({
        where: { id: operation.sessionId },
        data: { generationState: { ...work.operation, status: 'RUNNING' } },
      });
    });
    await setSiteConfig({ ttsProvider: null }, identity.ownerId);
    await expect(
      sottoTransaction(instance.database, (database) =>
        validatePracticePreparation(database, operation.sessionId, operation.id)
      )
    ).rejects.toThrow(/speech provider/);
    expect((await saved(operation.sessionId)).generation.requirements.skills.LISTENING.state).toBe(
      'REQUIRED'
    );
  });

  it('fences queued audio after published practice when the selected speech endpoint changes', async () => {
    await setSiteConfig(
      { ttsProvider: 'local', ttsBaseUrl: 'http://local-tts:8000' },
      identity.ownerId
    );
    const operation = await requestPracticePreparation(courseId, 'FULL', execution);
    await instance.database.practiceSession.update({
      where: { id: operation.sessionId },
      data: {
        generationState: { ...operation, status: 'RUNNING' },
      },
    });
    const episode = await instance.database.episode.create({
      data: {
        userId: identity.ownerId,
        title: 'Saved listening',
        topic: 'Travel',
        status: 'SCRIPT_READY',
        audioGenerationKey: 'practice-audio-generation',
      },
    });
    await sottoTransaction(instance.database, (database) =>
      registerPreparationAudio(
        database,
        operation,
        episode.id,
        episode.audioGenerationKey!,
        'practice'
      )
    );
    const linked = (await saved(operation.sessionId)).operation;
    await instance.database.practiceSession.update({
      where: { id: operation.sessionId },
      data: {
        status: 'ACTIVE',
        generationState: { ...linked, status: 'COMPLETED' },
      },
    });
    await sottoTransaction(instance.database, (database) =>
      practicePreparationGrant(database, operation).complete(operation.grant)
    );
    await expect(
      sottoTransaction(instance.database, (database) =>
        validatePreparationAudio(database, episode.id, episode.audioGenerationKey!)
      )
    ).resolves.toBeUndefined();
    await setSiteConfig({ ttsBaseUrl: 'http://changed-tts:8000' }, identity.ownerId);
    await expect(
      sottoTransaction(instance.database, (database) =>
        validatePreparationAudio(database, episode.id, episode.audioGenerationKey!)
      )
    ).rejects.toThrow(/speech.*endpoint.*changed/);
    expect((await saved(operation.sessionId)).session.status).toBe('ACTIVE');
    expect(await instance.database.episode.findUnique({ where: { id: episode.id } })).toMatchObject(
      { status: 'SCRIPT_READY', audioGenerationKey: 'practice-audio-generation' }
    );
  });

  it('rejects a revoked original learner request without admitting practice', async () => {
    await identity.access.logout(identity.ownerToken);
    await expect(requestPracticePreparation(courseId, 'FULL', execution)).rejects.toThrow();
    expect(await instance.database.practiceSession.count()).toBe(0);
  });

  it('rolls back the session and delegated grant when durable admission fails', async () => {
    await instance.database.$executeRawUnsafe(
      `CREATE FUNCTION "${instance.schema}".reject_practice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state->'job'->>'handler' = 'practice-preparation' THEN RAISE EXCEPTION 'fixture admission failure'; END IF; RETURN NEW; END $$`
    );
    await instance.database.$executeRawUnsafe(
      `CREATE TRIGGER reject_practice BEFORE INSERT ON "${instance.schema}"."SidedoorState" FOR EACH ROW EXECUTE FUNCTION "${instance.schema}".reject_practice()`
    );
    try {
      await expect(requestPracticePreparation(courseId, 'FULL', execution)).rejects.toThrow();
      expect(await instance.database.practiceSession.count()).toBe(0);
      const rows = await instance.database.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) FROM "${instance.schema}"."SidedoorState" WHERE state->'grant'->>'action' = 'practice-parent-provider-request'`
      );
      expect(rows[0]?.count).toBe(0n);
    } finally {
      await instance.database.$executeRawUnsafe(
        `DROP TRIGGER reject_practice ON "${instance.schema}"."SidedoorState"`
      );
      await instance.database.$executeRawUnsafe(
        `DROP FUNCTION "${instance.schema}".reject_practice()`
      );
    }
  });

  it('cancels queued work durably and retains its saved history without provider dispatch', async () => {
    const operation = await requestPracticePreparation(courseId, 'FULL', execution);
    const job = await queuedJob(operation.id);
    expect((await cancelPracticePreparation(operation.sessionId, execution)).status).toBe(
      'CANCELLED'
    );
    await processPracticePreparation(job);
    const current = await saved(operation.sessionId);
    expect(current.session.status).toBe('CANCELLED');
    expect(current.operation.status).toBe('CANCELLED');
    expect(
      practicePreparingSchema.parse(await resumePractice(operation.sessionId, identity.ownerId))
        .preparationStatus
    ).toBe('CANCELLED');
    expect(
      (
        await requestPracticePreparation(courseId, 'FULL', execution, {
          requestId: operation.sessionId,
        })
      ).id
    ).toBe(operation.id);
  });

  it('retains the admitted identity after explicit discard and prevents a paid request replay', async () => {
    const operation = await requestPracticePreparation(courseId, 'FULL', execution);
    await cancelPracticePreparation(operation.sessionId, execution);
    await instance.database.practiceSession.delete({ where: { id: operation.sessionId } });
    await expect(
      requestPracticePreparation(courseId, 'FULL', execution, { requestId: operation.sessionId })
    ).rejects.toThrow(/discarded/);
    expect(await instance.database.practiceSession.count()).toBe(0);
    expect(
      await instance.database.practiceRequestReceipt.findUnique({
        where: { id: operation.sessionId },
      })
    ).toMatchObject({ courseId });
  });

  it('keeps published learner answers available when generation cancellation is requested', async () => {
    const operation = await requestPracticePreparation(courseId, 'VOCAB', execution);
    await instance.database.practiceSession.update({
      where: { id: operation.sessionId },
      data: {
        status: 'ACTIVE',
        generationState: { ...operation, status: 'COMPLETED' },
        learnerAnswers: { v0: 2 },
        items: [
          {
            id: 'v0',
            prompt: 'Choose the greeting',
            options: ['A', 'B', 'C', 'D'],
            correctIndex: 2,
            explanation: 'C is the greeting.',
          },
        ],
      },
    });
    await expect(cancelPracticePreparation(operation.sessionId, execution)).rejects.toThrow(
      /published/
    );
    expect(await resumePractice(operation.sessionId, identity.ownerId)).toMatchObject({
      status: 'ready',
      learnerAnswers: { v0: 2 },
    });
    expect((await saved(operation.sessionId)).session.status).toBe('ACTIVE');
  });

  it('settles drained cancellation while polling rather than requiring another cancel request', async () => {
    const operation = await requestPracticePreparation(courseId, 'FULL', execution);
    await instance.database.practiceSession.update({
      where: { id: operation.sessionId },
      data: { generationState: { ...operation, status: 'CANCELLING' } },
    });
    expect(
      practicePreparingSchema.parse(await resumePractice(operation.sessionId, identity.ownerId))
        .preparationStatus
    ).toBe('CANCELLED');
    expect((await saved(operation.sessionId)).session.status).toBe('CANCELLED');
  });

  it('fences missed heartbeats without treating the observation as confirmed execution cleanup', async () => {
    const operation = await requestPracticePreparation(courseId, 'FULL', execution);
    const job = await queuedJob(operation.id);
    const record = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operation.id)
    );
    if (!record) throw new Error('Missing receipt');
    const binding = {
      id: randomUUID(),
      parentId: operation.id,
      fingerprint: record.fingerprint,
      executorId: randomUUID(),
    };
    await sottoTransaction(instance.database, (database) =>
      sottoJobExecutions(database).begin(binding)
    );
    await instance.database.practiceSession.update({
      where: { id: operation.sessionId },
      data: {
        generationState: { ...operation, status: 'RUNNING', updatedAt: Date.now() - 31_000 },
      },
    });
    await processPracticePreparation(job);
    expect((await saved(operation.sessionId)).operation.status).toBe('UNRESOLVED');
    expect((await cancelPracticePreparation(operation.sessionId, execution, true)).status).toBe(
      'CANCELLING'
    );
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobExecutions(database).blockingStatus(operation.id, record.fingerprint)
      )
    ).toBe('active');
    await sottoTransaction(instance.database, (database) =>
      sottoJobExecutions(database).settle(binding)
    );
    expect((await reconcilePracticePreparation(operation.sessionId, identity.ownerId)).status).toBe(
      'CANCELLED'
    );
  });

  it('preserves a live executor and its authority when another delivery observes a recent heartbeat', async () => {
    const operation = await requestPracticePreparation(courseId, 'FULL', execution);
    const job = await queuedJob(operation.id);
    const record = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operation.id)
    );
    if (!record) throw new Error('Missing receipt');
    const binding = {
      id: randomUUID(),
      parentId: operation.id,
      fingerprint: record.fingerprint,
      executorId: randomUUID(),
    };
    await sottoTransaction(instance.database, (database) =>
      sottoJobExecutions(database).begin(binding)
    );
    await instance.database.practiceSession.update({
      where: { id: operation.sessionId },
      data: { generationState: { ...operation, status: 'RUNNING', updatedAt: Date.now() } },
    });
    await processPracticePreparation(job);
    expect((await saved(operation.sessionId)).operation.status).toBe('RUNNING');
    expect(
      (
        await sottoTransaction(instance.database, (database) =>
          practicePreparationGrant(database, operation).read(operation.grant)
        )
      ).status
    ).toBe('active');
    await sottoTransaction(instance.database, (database) =>
      sottoJobExecutions(database).settle(binding)
    );
  });

  it('stops subsequent provider dispatches after an ambiguous outcome while retaining the unknown receipt', async () => {
    const operation = await requestPracticePreparation(courseId, 'FULL', execution);
    await instance.database.practiceSession.update({
      where: { id: operation.sessionId },
      data: { generationState: { ...operation, status: 'RUNNING' } },
    });
    const request = learningPreparationProviderRequest(
      {
        selection: operation.selection,
        admit: async (database, attempt) => {
          const current = await validatePracticePreparation(
            database,
            operation.sessionId,
            operation.id
          );
          return practicePreparationGrant(database, current.operation).admit(
            current.operation.grant,
            attempt
          );
        },
        settle: (database, attempt, outcome) =>
          practicePreparationGrant(database, operation).settle(operation.grant, attempt, outcome),
      },
      new AbortController().signal,
      () => {}
    );
    const dispatch = vi.fn(async () => {
      throw new Error('Provider connection closed after dispatch');
    });
    const http = new Request('https://api.openai.com/v1/responses', { method: 'POST', body: '{}' });
    await expect(request(http, dispatch)).rejects.toThrow(/unresolved/);
    await expect(request(http, dispatch)).rejects.toThrow(/unresolved/);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const grant = await sottoTransaction(instance.database, (database) =>
      practicePreparationGrant(database, operation).read(operation.grant)
    );
    expect(grant.attempts).toHaveLength(1);
    expect(grant.attempts[0].outcome).toBe('unknown');
  });

  it.each([false, true])(
    'publishes complete FULL text material through real HTTP generation with STT=%s and no TTS',
    async (stt) => {
      vi.unstubAllGlobals();
      await sottoTransaction(instance.database, async (database) => {
        const storage = await sottoCredentialStorage(database, 'ai', 'openai');
        const owner = await captureSottoCredentialOwner(database, identity.ownerId);
        const target = { ...storage.slot, owner };
        const head = await storage.owned.head(target);
        await storage.owned.remove(target, head.revision, randomUUID());
      });
      const requests: string[] = [];
      const failures: string[] = [];
      const passage =
        'Mia sagt Hallo. Sie wohnt in Berlin und lernt Deutsch. Heute trifft sie Ana im Park.';
      const server = createServer(async (request, response) => {
        try {
          let body = '';
          for await (const chunk of request) body += chunk.toString();
          requests.push(body);
          const payload = JSON.parse(body) as { messages: { role: string; content: string }[] };
          const system =
            payload.messages.find((message) => message.role === 'system')?.content ?? '';
          const user = payload.messages.at(-1)?.content ?? '';
          let content: unknown;
          let reviewed: { items?: { index: number }[]; questions?: { index: number }[] } = {};
          try {
            reviewed = JSON.parse(user);
          } catch {
            /* Generation instructions are plain text. */
          }
          if (system.startsWith('Extract useful'))
            content = [
              {
                lemma: 'Hallo',
                gloss: 'hello',
                pos: 'expression',
                sourceForm: 'Hallo',
                questionIndices: [0],
              },
            ];
          else if (reviewed.items)
            content = {
              items: reviewed.items.map(({ index }) => ({
                index,
                acceptable: true,
                issues: [],
                feedback: [],
              })),
            };
          else if (reviewed.questions)
            content = {
              passageAcceptable: true,
              issues: [],
              questions: reviewed.questions.map(({ index }) => ({
                index,
                acceptableOptionIndices: [0],
                issues: [],
              })),
            };
          else if (system.startsWith('You are a writing-practice'))
            content = [
              {
                taskType: 'transformation',
                sourceText: 'Ich wohne in Berlin. Change Ich to Mia.',
                task: 'Rewrite the supplied sentence about Mia.',
              },
              {
                taskType: 'correction',
                sourceText: 'Mia wohnen in Berlin.',
                task: 'Correct the verb in the supplied sentence.',
              },
              {
                taskType: 'completion',
                sourceText: 'Mia sagt ____. Complete with Hallo.',
                task: 'Complete the supplied greeting.',
              },
            ];
          else if (system.startsWith('You are a speaking-practice'))
            content = [
              'Hallo Ana.',
              'Ich wohne in Berlin.',
              'Ich lerne Deutsch.',
              'Heute treffen wir uns.',
            ].map((targetPhrase) => ({ targetPhrase, translation: 'A short everyday phrase.' }));
          else if (/Generate 5 (grammar|reading) questions/.test(user))
            content = {
              passage: user.includes('reading') ? passage : '',
              questions: Array.from({ length: 5 }, (_, index) => ({
                question: user.includes('reading')
                  ? 'Welche Begrüßung sagt Mia? ' + index
                  : 'Mia ____ in Berlin. ' + index,
                options: user.includes('reading')
                  ? ['Hallo', 'Tschüss', 'Gute Nacht', 'Auf Wiedersehen']
                  : ['wohnt', 'wohnen', 'wohnst', 'wohne'],
                correctIndex: 0,
                explanation: user.includes('reading')
                  ? 'Mia sagt Hallo im Text.'
                  : 'Mia takes the third-person singular form wohnt.',
                passageRef: '',
              })),
            };
          else throw new Error('Unexpected generation request: ' + system.slice(0, 100));
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({
              id: 'full-fixture',
              object: 'chat.completion',
              created: 1,
              model: 'full-fixture',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: JSON.stringify(content) },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
            })
          );
        } catch (failure) {
          failures.push(String(failure));
          response.writeHead(500, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: { message: String(failure) } }));
        }
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Missing loopback fixture address');
      const endpoint = 'http://127.0.0.1:' + address.port + '/v1';
      try {
        await setSiteConfig(
          {
            aiProvider: 'local',
            aiModel: 'full-fixture',
            aiBaseUrl: endpoint,
            ttsProvider: null,
            sttProvider: stt ? 'local' : null,
            sttModel: stt ? 'full-fixture' : null,
            sttBaseUrl: stt ? endpoint : null,
          },
          identity.ownerId
        );
        await instance.database.user.update({
          where: { id: identity.ownerId },
          data: { preferredAiProvider: 'local', preferredAiModel: 'local:full-fixture' },
        });
        const course = await instance.database.course.findUniqueOrThrow({
          where: { id: courseId },
        });
        await instance.database.lesson.upsert({
          where: { curriculumId_slug: { curriculumId: course.curriculumId, slug: 'full-fixture' } },
          update: {},
          create: {
            curriculumId: course.curriculumId,
            slug: 'full-fixture',
            level: 'A1',
            order: 1,
            title: 'Greetings',
            objective: 'Greet Ana and describe where Mia lives',
            grammarPoints: ['present'],
            targetVocab: [{ lemma: 'Hallo', gloss: 'hello' }],
            vocabThemes: ['greetings'],
          },
        });
        const operation = await requestPracticePreparation(courseId, 'FULL', execution, {
          requestId: randomUUID(),
        });
        const job = await queuedJob(operation.id);
        await processPracticePreparation(job);
        const completed = await saved(operation.sessionId);
        expect(
          completed.operation.status,
          JSON.stringify({
            failures,
            requests: requests.map((body) => {
              const request = JSON.parse(body);
              return request.messages.map((message: { role: string; content: string }) => ({
                role: message.role,
                excerpt: message.content.slice(0, 100),
              }));
            }),
          })
        ).toBe('COMPLETED');
        expect(completed.session.status).toBe('ACTIVE');
        const resumed = await resumePractice(operation.sessionId, identity.ownerId);
        expect(resumed).toMatchObject({ status: 'ready_full', sessionId: operation.sessionId });
        if (resumed.status !== 'ready_full') throw new Error('Full practice was not published');
        expect(resumed.items.filter((item) => item.id.startsWith('g'))).toHaveLength(5);
        expect(resumed.items.filter((item) => item.id.startsWith('r'))).toHaveLength(5);
        expect(resumed.writingPrompts).toHaveLength(3);
        expect(resumed.speakingPrompts).toHaveLength(stt ? 4 : 0);
        expect(resumed.speakingPrompts.every((prompt) => prompt.referenceTtsUrl === null)).toBe(
          true
        );
        expect(resumed.skillRequirements?.skills.LISTENING.state).toBe('EXEMPT_NO_PROVIDER');
        expect(resumed.skillRequirements?.skills.SPEAKING.state).toBe(
          stt ? 'REQUIRED' : 'EXEMPT_NO_PROVIDER'
        );
        const stored = await instance.database.practiceSession.findUniqueOrThrow({
          where: { id: operation.sessionId },
        });
        expect(stored.readingVocabulary).toMatchObject({
          passageText: passage,
          sourceHash: createHash('sha256').update(passage).digest('hex'),
          words: [{ lemma: 'Hallo', sourceForm: 'Hallo', questionIds: ['r0'] }],
        });
        expect(
          await instance.database.learnerVocab.findUnique({
            where: { courseId_lemma: { courseId, lemma: 'Hallo' } },
          })
        ).toMatchObject({ reps: 0 });
        const dispatched = requests.length;
        expect(dispatched).toBeGreaterThan(0);
        await processPracticePreparation(job);
        expect(
          (
            await requestPracticePreparation(courseId, 'FULL', execution, {
              requestId: operation.sessionId,
            })
          ).id
        ).toBe(operation.id);
        expect(requests).toHaveLength(dispatched);
        await sottoTransaction(instance.database, async (database) => {
          const record = await sottoJobOutbox(database).read(operation.id);
          expect(record?.complete).toBe(true);
          await sottoJobExecutions(database).requireParentDrained(
            operation.id,
            record!.fingerprint
          );
        });
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
    }
  );

  it('publishes an unavailable receipt once and resumes it without repeating generation', async () => {
    const operation = await requestPracticePreparation(courseId, 'VOCAB', execution);
    const job = await queuedJob(operation.id);
    await processPracticePreparation(job);
    await processPracticePreparation(job);
    const current = await saved(operation.sessionId);
    expect(current.operation.status).toBe('COMPLETED');
    expect(current.session.status).toBe('FAILED');
    expect(await resumePractice(operation.sessionId, identity.ownerId)).toEqual({
      status: 'unavailable',
      reason: 'not_enough_vocab',
    });
    const record = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operation.id)
    );
    if (!record) throw new Error('Missing completed receipt');
    expect(record.complete).toBe(true);
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobExecutions(database).blockingStatus(operation.id, record.fingerprint)
      )
    ).toBeNull();
  });

  it('fences an interrupted running attempt and requires acknowledgement before cancellation recovery', async () => {
    const operation = await requestPracticePreparation(courseId, 'FULL', execution);
    await instance.database.practiceSession.update({
      where: { id: operation.sessionId },
      data: { generationState: { ...operation, status: 'RUNNING' } },
    });
    await processPracticePreparation(await queuedJob(operation.id));
    const current = await saved(operation.sessionId);
    expect(current.operation.status).toBe('UNRESOLVED');
    await expect(cancelPracticePreparation(operation.sessionId, execution)).rejects.toThrow(
      /Acknowledge/
    );
    expect((await cancelPracticePreparation(operation.sessionId, execution, true)).status).toBe(
      'CANCELLED'
    );
  });
});
