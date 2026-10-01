// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  resolveSottoRequest,
  requireOriginalSottoAdmission,
} from '@/lib/sidedoor/access/core/request-identity';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  StorageWriteJournal,
  prepareStorageTombstone,
  openExecutionLocation,
  planExecutionWorkspace,
  createExecutionWorkspace,
} from 'thesidedoor-core/storage';
import { sottoCredentialStorage } from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import {
  requestClassPreparation,
  cancelClassPreparation,
  readPreparationActivity,
  recoverClassPreparation,
  classPreparationStore,
  validateClassPreparation,
  recordClassPreparationFailure,
} from '@/lib/classes/preparation';
import { classPreparationGrant } from '@/lib/classes/preparation-grant';
import { preparationProviderRequest } from '@/lib/classes/preparation-provider';
import { resolveCapturedLearningAi } from '@/lib/learning-ai';
import { processClassPreparation } from '@/workers/classes/class-preparation.worker';
import { recoverIsolatedPreparationExecution } from '@/lib/agents/isolated/isolated-agent-recovery';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { createSottoProviderTransport } from '@/lib/sidedoor/credentials/runtime/provider-execution';
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
suite('durable preparation admission and provider accounting', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let courseId: string;
  let execution: SottoProviderExecution;
  let executionDirectory: string;
  let temporaryRoot: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('preparation_parent');
    boundary.database = instance.database;
    temporaryRoot = await mkdtemp(join(tmpdir(), 'preparation-parent-test-'));
    executionDirectory = join(temporaryRoot, 'executions');
  });
  beforeEach(async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', executionDirectory);
    identity = await instance.reset();
    await instance.seedAiCredential(identity.ownerId, 'openai', 'preparation-fixture-secret');
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: {
        preferredAiProvider: 'openai',
        preferredAiModel: getAiProviderMeta('openai').defaultModel,
      },
    });
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Preparation fixture' },
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
    execution = await authority(identity.ownerToken);
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

  async function authority(token: string): Promise<SottoProviderExecution> {
    const request = new Request('http://localhost', {
      headers: { cookie: `sotto_session=${token}` },
    });
    const original = await sottoTransaction(instance.database, (database) =>
      resolveSottoRequest(database, request)
    );
    if (!original || original.kind !== 'content') throw new Error('Expected learner fixture');
    return {
      userId: original.userId,
      signal: request.signal,
      authorize: async (database) => {
        await requireOriginalSottoAdmission(database, request, original);
        return { userId: original.userId };
      },
    };
  }
  async function running(maxProviderRequests = 2) {
    const operation = await requestClassPreparation(courseId, execution, { maxProviderRequests });
    await sottoTransaction(instance.database, (database) =>
      classPreparationStore(database, courseId).transact((state) => {
        if (!state) throw new Error('Missing operation');
        state.status = 'RUNNING';
      })
    );
    return { ...operation, status: 'RUNNING' as const };
  }

  async function queuedJob(operationId: string) {
    const record = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operationId)
    );
    if (!record) throw new Error('Missing outbox fixture');
    return {
      id: operationId,
      name: 'class-preparation.v1',
      data: { operationId, fingerprint: record.fingerprint },
    } as Job<{ operationId: string; fingerprint: string }>;
  }

  async function lesson() {
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    return instance.database.lesson.create({
      data: {
        curriculumId: course.curriculumId,
        level: 'A1',
        order:
          (await instance.database.lesson.count({ where: { curriculumId: course.curriculumId } })) +
          1,
        slug: randomUUID(),
        title: 'Greetings',
        objective: 'Greet a friend',
        grammarPoints: [],
        vocabThemes: [],
        targetVocab: [],
      },
    });
  }

  it('commits exact scoped work and grant before acknowledgement and reuses admitted requests', async () => {
    const input = { topic: 'Private learner topic', maxProviderRequests: 3 };
    const operation = await requestClassPreparation(courseId, execution, input);
    const replay = await requestClassPreparation(courseId, execution, input);
    expect(replay.id).toBe(operation.id);
    const record = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operation.id)
    );
    expect(record?.job.payload).toMatchObject({
      courseId,
      operationId: operation.id,
      topic: input.topic,
    });
    const stored = await sottoTransaction(instance.database, (database) =>
      classPreparationStore(database, courseId).read()
    );
    expect(JSON.stringify(stored)).not.toContain(input.topic);
    const grant = await sottoTransaction(instance.database, (database) =>
      classPreparationGrant(database, operation).read(operation.grant)
    );
    expect(grant.grant.maxRequests).toBe(3);
    expect(grant.grant.resource.id).toBe(`course:${courseId}`);
    expect(JSON.stringify(grant)).not.toContain('preparation-fixture-secret');
    await expect(
      requestClassPreparation(courseId, execution, { ...input, maxProviderRequests: 4 })
    ).rejects.toThrow('active preparation');
  });

  it('does not admit an operation under a revoked original request', async () => {
    await identity.access.logout(identity.ownerToken);
    await expect(requestClassPreparation(courseId, execution)).rejects.toThrow();
    expect(
      await sottoTransaction(instance.database, (database) =>
        classPreparationStore(database, courseId).read()
      )
    ).toBeNull();
  });

  it('rolls the operation and grant back if durable outbox admission fails', async () => {
    await instance.database.$executeRawUnsafe(
      `CREATE FUNCTION "${instance.schema}".reject_preparation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state->'job'->>'handler' = 'class-preparation' THEN RAISE EXCEPTION 'fixture outbox failure'; END IF; RETURN NEW; END $$`
    );
    await instance.database.$executeRawUnsafe(
      `CREATE TRIGGER reject_preparation BEFORE INSERT ON "${instance.schema}"."SidedoorState" FOR EACH ROW EXECUTE FUNCTION "${instance.schema}".reject_preparation()`
    );
    try {
      await expect(requestClassPreparation(courseId, execution)).rejects.toThrow();
      expect(
        await sottoTransaction(instance.database, (database) =>
          classPreparationStore(database, courseId).read()
        )
      ).toBeNull();
      const rows = await instance.database.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) FROM "${instance.schema}"."SidedoorState" WHERE state->'grant'->>'action' = 'class-parent-provider-request'`
      );
      expect(rows[0]?.count).toBe(0n);
    } finally {
      await instance.database.$executeRawUnsafe(
        `DROP TRIGGER reject_preparation ON "${instance.schema}"."SidedoorState"`
      );
      await instance.database.$executeRawUnsafe(
        `DROP FUNCTION "${instance.schema}".reject_preparation()`
      );
    }
  });

  it('settles expired queued work without contacting a provider or leaving an active execution', async () => {
    const operation = await requestClassPreparation(courseId, execution);
    const record = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operation.id)
    );
    if (!record) throw new Error('Missing outbox fixture');
    vi.spyOn(Date, 'now').mockReturnValue(operation.expiresAt);
    vi.stubGlobal('fetch', async () => {
      throw new Error('Expired work must not dispatch');
    });
    await processClassPreparation({
      id: operation.id,
      name: 'class-preparation.v1',
      data: { operationId: operation.id, fingerprint: record.fingerprint },
    } as Job<unknown>);
    expect((await readPreparationActivity(courseId, execution))?.status).toBe('FAILED');
    await expect(
      sottoTransaction(instance.database, (database) =>
        sottoJobExecutions(database).requireParentDrained(operation.id, record.fingerprint)
      )
    ).resolves.toBeUndefined();
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(operation.id)
      )
    ).toMatchObject({ complete: true });
  });

  it('runs and replays a completed preparation without repeating generation', async () => {
    const target = await lesson();
    await instance.database.courseClass.create({
      data: { courseId, lessonId: target.id, order: 1, status: 'AVAILABLE' },
    });
    const operation = await requestClassPreparation(courseId, execution);
    const job = await queuedJob(operation.id);
    vi.stubGlobal('fetch', async () => {
      throw new Error('Gated work must not dispatch');
    });
    await processClassPreparation(job);
    await processClassPreparation(job);
    const current = await sottoTransaction(instance.database, (database) =>
      classPreparationStore(database, courseId).read()
    );
    expect(current).toMatchObject({ status: 'COMPLETED', result: 'gated' });
    expect(
      (
        await sottoTransaction(instance.database, (database) =>
          classPreparationGrant(database, operation).read(operation.grant)
        )
      ).status
    ).toBe('completed');
    await expect(
      sottoTransaction(instance.database, (database) =>
        sottoJobExecutions(database).requireParentDrained(operation.id, job.data.fingerprint)
      )
    ).resolves.toBeUndefined();
  });

  it('fences a resumed running task without redispatching and requires explicit recovery', async () => {
    const operation = await running();
    vi.stubGlobal('fetch', async () => {
      throw new Error('Interrupted work must not dispatch');
    });
    await processClassPreparation(await queuedJob(operation.id));
    expect((await readPreparationActivity(courseId, execution))?.status).toBe('UNRESOLVED');
    await expect(requestClassPreparation(courseId, execution)).rejects.toThrow(
      'active preparation'
    );
    expect(
      (await recoverClassPreparation(courseId, execution, { acknowledgeUnknownOutcome: true }))
        .status
    ).toBe('CANCELLED');
  });

  it('rejects cross-learner activity reads and returns only sanitized accounting', async () => {
    await requestClassPreparation(courseId, execution, {
      topic: 'Private topic',
      maxProviderRequests: 2,
    });
    const other = await identity.household('Other learner');
    await expect(readPreparationActivity(courseId, await authority(other.token))).rejects.toThrow(
      'Course not found'
    );
    const activity = await readPreparationActivity(courseId, execution);
    expect(activity).toMatchObject({
      providerRequestsAdmitted: 0,
      maxProviderRequests: 2,
      events: [{ type: 'created' }],
    });
    expect(JSON.stringify(activity)).not.toContain('Private topic');
    expect(JSON.stringify(activity)).not.toContain('preparation-fixture-secret');
  });

  it('counts every provider HTTP attempt and refuses retry beyond the admitted cap', async () => {
    const operation = await running(2);
    let dispatched = 0;
    const provider = preparationProviderRequest(operation, new AbortController().signal, () => {
      throw new Error('Unexpected uncertainty');
    });
    const request = () =>
      new Request('https://api.openai.com/v1/responses', {
        method: 'POST',
        body: JSON.stringify({ model: operation.selection.model, input: 'Private input' }),
      });
    const dispatch = async () => {
      dispatched += 1;
      return new Response('{"output":"fixture"}', { status: 200 });
    };
    expect(await (await provider(request(), dispatch)).text()).toContain('fixture');
    await provider(request(), dispatch);
    await expect(provider(request(), dispatch)).rejects.toMatchObject({ code: 'budget' });
    expect(dispatched).toBe(2);
    const activity = await readPreparationActivity(courseId, execution);
    expect(activity?.providerRequestsAdmitted).toBe(2);
    expect(activity?.events.map((event) => event.type)).toEqual([
      'created',
      'admitted',
      'succeeded',
      'admitted',
      'succeeded',
    ]);
    expect(JSON.stringify(activity)).not.toContain('Private input');
  });

  it('applies request accounting only after captured credential and destination admission', async () => {
    const operation = await running(1);
    const ai = await resolveCapturedLearningAi(identity.ownerId, {
      ...execution,
      learningSelection: operation.selection,
    });
    let sends = 0;
    vi.stubGlobal('fetch', async () => {
      sends += 1;
      return new Response('{}');
    });
    const transport = await createSottoProviderTransport(
      {
        ...ai.execution,
        providerRequest: preparationProviderRequest(operation, new AbortController().signal, () => {
          throw new Error('Unexpected uncertainty');
        }),
      },
      [{ method: 'POST', url: 'https://api.openai.com/v1/responses' }]
    );
    await expect(
      transport.authenticatedFetch('https://other.invalid/v1/responses', {
        method: 'POST',
        body: '{}',
      })
    ).rejects.toThrow('destination');
    expect((await readPreparationActivity(courseId, execution))?.providerRequestsAdmitted).toBe(0);
    await transport.authenticatedFetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: '{}',
    });
    await expect(
      transport.authenticatedFetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        body: '{}',
      })
    ).rejects.toMatchObject({ code: 'budget' });
    expect(sends).toBe(1);
  });

  it('retains unknown provider outcomes without replaying or refunding the attempt', async () => {
    const operation = await running(3);
    let uncertain = false;
    let sends = 0;
    const provider = preparationProviderRequest(operation, new AbortController().signal, () => {
      uncertain = true;
    });
    const request = () =>
      new Request('https://api.openai.com/v1/responses', { method: 'POST', body: '{}' });
    await expect(
      provider(request(), async () => {
        sends += 1;
        throw new Error('Connection lost');
      })
    ).rejects.toThrow('unresolved');
    await expect(
      provider(request(), async () => {
        sends += 1;
        return new Response('{}');
      })
    ).rejects.toThrow('unresolved');
    expect({ uncertain, sends }).toEqual({ uncertain: true, sends: 1 });
    expect((await readPreparationActivity(courseId, execution))?.events.at(-1)?.type).toBe(
      'unknown'
    );
  });

  it('cancels queued work before any dispatch and seals its outbox record', async () => {
    const operation = await requestClassPreparation(courseId, execution);
    expect((await cancelClassPreparation(courseId, execution))?.status).toBe('CANCELLED');
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(operation.id)
      )
    ).toMatchObject({ complete: true });
    expect(
      (
        await sottoTransaction(instance.database, (database) =>
          classPreparationGrant(database, operation).read(operation.grant)
        )
      ).status
    ).toBe('revoked');
  });

  it('keeps a cancelled task fenced while its admitted execution is still active', async () => {
    const operation = await running();
    const record = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operation.id)
    );
    if (!record) throw new Error('Missing outbox fixture');
    const binding = {
      id: randomUUID(),
      parentId: operation.id,
      fingerprint: record.fingerprint,
      executorId: randomUUID(),
    };
    await sottoTransaction(instance.database, (database) =>
      sottoJobExecutions(database).begin(binding)
    );
    expect((await cancelClassPreparation(courseId, execution))?.status).toBe('CANCELLING');
    await expect(
      recoverClassPreparation(courseId, execution, { acknowledgeUnknownOutcome: true })
    ).rejects.toThrow('cleanup');
    await sottoTransaction(instance.database, (database) =>
      sottoJobExecutions(database).settle(binding)
    );
    expect(
      (await recoverClassPreparation(courseId, execution, { acknowledgeUnknownOutcome: true }))
        .status
    ).toBe('CANCELLED');
  });

  it('preserves published authority when the publication commit acknowledgement is lost', async () => {
    const operation = await running();
    const outbox = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operation.id)
    );
    if (!outbox) throw new Error('Missing outbox fixture');
    await sottoTransaction(instance.database, async (database) => {
      await classPreparationGrant(database, operation).complete(operation.grant);
      await classPreparationStore(database, courseId).transact((current) => {
        if (!current) throw new Error('Missing operation');
        current.status = 'COMPLETED';
        current.result = 'created';
      });
      await sottoJobOutbox(database).complete(operation.id, outbox.fingerprint);
    });
    // A caller observing a lost COMMIT response enters the same durable failure recorder.
    await sottoTransaction(instance.database, (database) =>
      recordClassPreparationFailure(database, operation, outbox.fingerprint, false)
    );
    expect((await readPreparationActivity(courseId, execution))?.status).toBe('COMPLETED');
    expect(
      (
        await sottoTransaction(instance.database, (database) =>
          classPreparationGrant(database, operation).read(operation.grant)
        )
      ).status
    ).toBe('completed');
  });

  it.each([false, true])(
    'requires the original isolated workspace before acknowledging unknown charges (missing: %s)',
    async (missingWorkspace) => {
      await instance.seedAiCredential(identity.ownerId, 'anthropic', 'isolated-fixture-key');
      vi.stubEnv('SOTTO_ISOLATED_CLAUDE_IMAGE', `registry.invalid/agent@sha256:${'a'.repeat(64)}`);
      await instance.database.user.update({
        where: { id: identity.ownerId },
        data: {
          preferredAiProvider: 'claude-code',
          preferredAiModel: 'claude-code:claude-sonnet-4-6',
        },
      });
      const operation = await running();
      const job = await queuedJob(operation.id);
      const binding = {
        id: randomUUID(),
        parentId: operation.id,
        fingerprint: job.data.fingerprint,
        executorId: randomUUID(),
      };
      const location = await openExecutionLocation(executionDirectory, { create: true });
      const plan = await planExecutionWorkspace(
        location.root.root,
        location.locationId,
        binding.id
      );
      await sottoTransaction(instance.database, (database) =>
        sottoJobExecutions(database).begin(binding, plan)
      );
      const workspace = await createExecutionWorkspace(plan);
      const attempt = { id: randomUUID(), fingerprint: 'c'.repeat(64) };
      await sottoTransaction(instance.database, async (database) => {
        const journal = sottoJobExecutions(database);
        await journal.attachWorkspace(binding, workspace);
        await journal.markCleanupUnconfirmed(binding);
        const grant = classPreparationGrant(database, operation);
        await grant.admit(operation.grant, attempt);
        await grant.settle(operation.grant, attempt, 'unknown');
      });
      if (missingWorkspace) {
        await rm(workspace.directory.root, { recursive: true, force: true });
        await expect(
          recoverIsolatedPreparationExecution({ binding, supervisorStopped: true })
        ).rejects.toThrow();
        await expect(
          recoverClassPreparation(courseId, execution, { acknowledgeUnknownOutcome: true })
        ).rejects.toThrow('cleanup');
        expect(
          (
            await sottoTransaction(instance.database, (database) =>
              classPreparationGrant(database, operation).read(operation.grant)
            )
          ).attempts[0].outcome
        ).toBe('unknown');
        return;
      }
      expect(
        await recoverIsolatedPreparationExecution({ binding, supervisorStopped: true })
      ).toEqual({ containers: 0, executionId: binding.id });
      expect((await readPreparationActivity(courseId, execution))?.status).toBe('UNRESOLVED');
      expect(
        (
          await sottoTransaction(instance.database, (database) =>
            classPreparationGrant(database, operation).read(operation.grant)
          )
        ).attempts[0].outcome
      ).toBe('unknown');
      expect(
        (await recoverClassPreparation(courseId, execution, { acknowledgeUnknownOutcome: true }))
          .status
      ).toBe('CANCELLED');
    }
  );

  it('pins the original model despite preference changes and rejects credential replacement', async () => {
    const operation = await running();
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: { preferredAiProvider: 'anthropic', preferredAiModel: 'different-preference' },
    });
    const captured = await resolveCapturedLearningAi(identity.ownerId, {
      ...execution,
      learningSelection: operation.selection,
    });
    expect(captured.model).toBe(operation.selection.model);
    const credential = captured.execution.credential;
    if (!credential) throw new Error('Missing credential fixture');
    await sottoTransaction(instance.database, async (database) => {
      const storage = await sottoCredentialStorage(database, 'ai', 'openai');
      const target = { ...storage.slot, owner: credential.selected.credential.owner };
      const current = await storage.owned.head(target);
      await storage.owned.replace(
        storage.owned.prepareReplacement(target, {
          expectedHeadRevision: current.revision,
          credentialRevision: randomUUID(),
          values: { apiKey: 'replacement-fixture-secret' },
          binding: credential.selected.credential.binding,
          availability: 'enabled',
          label: null,
          metadata: { createdAt: 1, updatedAt: 2, lastUsedAt: null },
        })
      );
    });
    await expect(
      resolveCapturedLearningAi(identity.ownerId, {
        ...execution,
        learningSelection: operation.selection,
      })
    ).rejects.toThrow();
  });

  it('rejects erased resource scopes before a provider attempt', async () => {
    const operation = await running();
    await sottoTransaction(instance.database, (database) =>
      new StorageWriteJournal(
        {
          query: (sql, values) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      ).forbidWrites(
        prepareStorageTombstone({
          namespace: SIDEDOOR_STATE_ID,
          subjectId: `course:${courseId}`,
          generation: operation.courseCreatedAt,
          jobId: randomUUID(),
        })
      )
    );
    await expect(
      sottoTransaction(instance.database, (database) =>
        validateClassPreparation(database, courseId, operation.id)
      )
    ).rejects.toThrow();
  });

  it('fails effect authorization after the resource generation changes', async () => {
    const operation = await running();
    await instance.database.course.update({
      where: { id: courseId },
      data: { createdAt: new Date(Date.now() + 10_000) },
    });
    await expect(
      sottoTransaction(instance.database, (database) =>
        validateClassPreparation(database, courseId, operation.id)
      )
    ).rejects.toThrow('owner changed');
  });

  it('requires explicit deferred audio for scheduled preparation and saves its exact time', async () => {
    const availableAt = Date.now() + 60_000;
    await expect(requestClassPreparation(courseId, execution, { availableAt })).rejects.toThrow(
      'audio review'
    );
    const operation = await requestClassPreparation(courseId, execution, {
      availableAt,
      deferAudio: true,
      timeZone: 'America/Bogota',
    });
    expect(operation).toMatchObject({
      availableAt,
      deferAudio: true,
      timeZone: 'America/Bogota',
      maxProviderRequests: 128,
    });
    await expect(
      requestClassPreparation(courseId, execution, {
        availableAt: availableAt + 1000,
        deferAudio: true,
      })
    ).rejects.toThrow();
  });
});
