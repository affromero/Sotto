// @vitest-environment private-redis
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { registerPrerequisiteReadCases } from './cases/read-cases';
import { registerAssessmentStatusCases } from './cases/assessment-status-cases';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Worker } from 'bullmq';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classPreludeResponseSchema,
  classFocusSnapshotSchema,
  classPrerequisiteResponseSchema,
  createSkillRequirements,
} from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';
import { sampleTeaching } from '../../../helpers/learning/class-teaching';
import { prerequisiteDirectionFixture } from '../../../helpers/learning/prerequisite-provider';
import { readClassTeachingPreludeInTransaction } from '@/lib/classes/lesson/initial-a1-provenance';
import {
  submitClass,
  ClassIncompleteError,
} from '@/lib/learning/classes/progress/class-submission';
import { authorizedLearnerExecution } from '../../../helpers/runtime/provider-execution';
const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SOTTO_TEST_PRIVATE_REDIS_URL
    ? describe
    : describe.skip;
suite('saved prerequisite request through the real interaction worker', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let classId: string;
  let route: typeof import('@/app/api/v1/classes/[classId]/prerequisite/route');
  let classRoute: typeof import('@/app/api/v1/classes/[classId]/route');
  let progressRecoveryRoute: typeof import('@/app/api/v1/classes/[classId]/progress-recovery/route');
  let focusSnapshotRoute: typeof import('@/app/api/v1/classes/[classId]/focus-snapshot/route');
  let acknowledgmentRoute: typeof import('@/app/api/v1/classes/[classId]/prerequisite/acknowledge/route');
  let preludeRoute: typeof import('@/app/api/v1/classes/[classId]/teaching-prelude/route');
  let preludeAckRoute: typeof import('@/app/api/v1/classes/[classId]/teaching-prelude/acknowledge/route');
  let preludePrepareRoute: typeof import('@/app/api/v1/classes/[classId]/teaching-prelude/prepare/route');
  let assessmentStatusRoute: typeof import('@/app/api/v1/classes/[classId]/assessment/status/route');
  let runtime: typeof import('@/lib/queue');
  let processor: typeof import('@/workers/interaction.worker');
  let worker: Worker | undefined;
  let directory: string;
  let calls: string[];
  let loseConnection: boolean;
  let unsafeCandidate: boolean;
  let changeOnDirection: boolean;
  let privateCleanupAuthorized = false;

  beforeAll(async () => {
    const redis = new URL(process.env.SOTTO_TEST_PRIVATE_REDIS_URL!);
    directory = await mkdtemp(join(tmpdir(), 'sotto-prerequisite-api-'));
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(directory, 'executions'));
    instance = await createSharedTestInstance('prerequisite_api');
    boundary.database = instance.database;
    runtime = await import('@/lib/queue');
    const connection = (await import('@/lib/redis')).getSharedQueueRedisClient();
    if (
      connection.options.host !== redis.hostname ||
      connection.options.port !== Number(redis.port) ||
      (connection.options.db ?? 0) !== Number(redis.pathname.slice(1) || '0') ||
      Boolean(connection.options.tls) !== (redis.protocol === 'rediss:')
    )
      throw new Error('Prerequisite queue is not connected to its private Redis');
    privateCleanupAuthorized = true;
    route = await import('@/app/api/v1/classes/[classId]/prerequisite/route');
    classRoute = await import('@/app/api/v1/classes/[classId]/route');
    progressRecoveryRoute = await import('@/app/api/v1/classes/[classId]/progress-recovery/route');
    focusSnapshotRoute = await import('@/app/api/v1/classes/[classId]/focus-snapshot/route');
    acknowledgmentRoute =
      await import('@/app/api/v1/classes/[classId]/prerequisite/acknowledge/route');
    preludeRoute = await import('@/app/api/v1/classes/[classId]/teaching-prelude/route');
    preludeAckRoute =
      await import('@/app/api/v1/classes/[classId]/teaching-prelude/acknowledge/route');
    preludePrepareRoute =
      await import('@/app/api/v1/classes/[classId]/teaching-prelude/prepare/route');
    assessmentStatusRoute = await import('@/app/api/v1/classes/[classId]/assessment/status/route');
    processor = await import('@/workers/interaction.worker');
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'prerequisite-test-key');
    identity = await instance.reset();
    await instance.seedAiCredential(
      identity.ownerId,
      'anthropic',
      'prerequisite-test-provider-key'
    );
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'ru' } },
      create: { nativeLang: 'es', targetLang: 'ru', title: 'Ruso' },
      update: {},
    });
    const lesson = await instance.database.lesson.upsert({
      where: { curriculumId_slug: { curriculumId: curriculum.id, slug: 'first' } },
      update: {},
      create: {
        curriculumId: curriculum.id,
        slug: 'first',
        level: 'A1',
        order: 1,
        title: 'Primeras palabras',
        objective: 'Pedir una bebida',
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
      data: {
        courseId: course.id,
        lessonId: lesson.id,
        order: 1,
        status: 'IN_PROGRESS',
        learnerAnswers: { draft: 'PRIVATE_ANSWER' },
        writingDrafts: { draft: 'PRIVATE_DRAFT' },
        skillRequirements: createSkillRequirements({
          scope: 'CLASS',
          nativeLang: 'es',
          targetLang: 'ru',
          level: 'A1',
          ttsProvider: null,
          sttProvider: null,
        }),
        adaptiveSeed: {
          teaching: {
            ...sampleTeaching,
            guidedPractice: {
              ...sampleTeaching.guidedPractice,
              answer: 'CONCEALED_GUIDED_ANSWER',
              explanation: 'CONCEALED_GUIDED_EXPLANATION',
            },
          },
        },
      },
    });
    classId = cls.id;
    for (const skill of ['GRAMMAR', 'READING'] as const) {
      const section = await instance.database.classSection.create({
        data: { classId, skill, attempt: 1, status: 'READY', seed: 'seed', spec: {} },
      });
      await instance.database.lessonQuestion.createMany({
        data: Array.from({ length: 5 }, (_, index) => ({
          sectionId: section.id,
          order: index + 1,
          skill,
          question:
            skill === 'GRAMMAR' && index === 3
              ? 'Преврати сообщение после приветствия в вопрос о собеседнике: сохрани лицо и настоящее время (sin añadir «ser»).\nПривет! Ты Павел.'
              : 'Pide té con cortesía.',
          options: ['Чай, пожалуйста', 'Спасибо', 'Привет', 'До свидания'],
          correctIndex: 0,
          explanation: 'CONCEALED_ASSESSMENT_EXPLANATION',
          ...(skill === 'READING' ? { passageText: 'Un texto.' } : {}),
        })),
      });
    }
    const writing = await instance.database.classSection.create({
      data: { classId, skill: 'WRITING', attempt: 1, status: 'READY', seed: 'seed', spec: {} },
    });
    await instance.database.writingPrompt.createMany({
      data: [1, 2, 3].map((order) => ({
        sectionId: writing.id,
        order,
        task: 'Escribe una petición.',
      })),
    });
    calls = [];
    loseConnection = false;
    unsafeCandidate = false;
    changeOnDirection = false;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = await new Request(input, init).text();
      calls.push(body);
      if (loseConnection) throw new Error('Connection lost after dispatch');
      const request = JSON.parse(body) as {
        system: string;
        messages: Array<{ content: string | Array<{ type: string; text?: string }> }>;
      };
      const message = request.messages.at(-1)!.content;
      const text =
        typeof message === 'string' ? message : message.map((part) => part.text ?? '').join('');
      const directionName = request.system.includes('Independently review each proposed direction')
        ? 'class_prerequisite_directions_review'
        : request.system.includes('Explain the action required for each supplied exercise')
          ? 'class_prerequisite_directions'
          : null;
      const direction = directionName
        ? prerequisiteDirectionFixture([{ content: text }], { jsonSchema: { name: directionName } })
        : null;
      if (directionName === 'class_prerequisite_directions' && changeOnDirection) {
        changeOnDirection = false;
        await instance.database.lessonQuestion.updateMany({
          where: { section: { classId }, skill: 'GRAMMAR' },
          data: { question: 'Una pregunta modificada durante la preparación.' },
        });
      }
      const content = direction
        ? JSON.parse(direction.content)
        : body.includes('Independently review the proposed prerequisite lesson')
          ? {
              prerequisitesCovered: true,
              accurate: true,
              understandable: true,
              answersConcealed: true,
              issues: [],
            }
          : {
              title: 'Pedir con cortesía',
              explanation: unsafeCandidate
                ? 'La respuesta correcta es чай.'
                : 'Al pedir, «пожалуйста» significa «por favor». En respuesta a las gracias significa «de nada». «Преврати» pide cambiar algo y «вопрос» significa pregunta.',
              examples: [
                {
                  target: 'Вода, пожалуйста',
                  meaning: 'Agua, por favor',
                  explanation: 'Es una petición.',
                },
              ],
            };
      return Response.json({
        id: 'fixture',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: JSON.stringify(content) }],
        model: 'fixture',
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 30 },
      });
    });
  });
  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    if (privateCleanupAuthorized) {
      await runtime.interactionQueue.drain(true);
      await runtime.interactionQueue.clean(0, 100, 'completed');
      await runtime.interactionQueue.clean(0, 100, 'failed');
    }
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await runtime?.interactionQueue.close();
    await (await import('@/lib/redis')).closeRedis();
    await instance?.close();
    boundary.database = null;
    await rm(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  const params = () => ({ params: Promise.resolve({ classId }) });
  registerAssessmentStatusCases(() => ({
    instance,
    identity,
    classId,
    assessmentStatusRoute,
    params,
    runtime,
    calls,
    setWorker: (value) => {
      worker = value;
    },
  }));

  const getPrelude = (token = identity.ownerToken) =>
    preludeRoute.GET(
      new NextRequest(`http://localhost:3000/api/v1/classes/${classId}/teaching-prelude`, {
        headers: { cookie: `sotto_session=${token}` },
      }),
      params()
    );
  const getFocusSnapshot = (token = identity.ownerToken) =>
    focusSnapshotRoute.GET(
      new NextRequest(`http://localhost:3000/api/v1/classes/${classId}/focus-snapshot`, {
        headers: { cookie: `sotto_session=${token}` },
      }),
      params()
    );
  const acknowledgePrelude = (
    input: unknown,
    token = identity.ownerToken,
    origin = 'http://localhost:3000'
  ) =>
    preludeAckRoute.POST(
      new NextRequest(
        `http://localhost:3000/api/v1/classes/${classId}/teaching-prelude/acknowledge`,
        {
          method: 'POST',
          headers: { cookie: `sotto_session=${token}`, origin, 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }
      ),
      params()
    );
  const get = (token = identity.ownerToken) =>
    route.GET(
      new NextRequest(`http://localhost:3000/api/v1/classes/${classId}/prerequisite`, {
        headers: { cookie: `sotto_session=${token}` },
      }),
      params()
    );
  const preparePrelude = (
    input: unknown,
    token = identity.ownerToken,
    origin = 'http://localhost:3000',
    recovery = false
  ) =>
    preludePrepareRoute.POST(
      new NextRequest(
        `http://localhost:3000/api/v1/classes/${classId}/teaching-prelude/prepare${recovery ? '?recover=1' : ''}`,
        {
          method: 'POST',
          headers: { cookie: `sotto_session=${token}`, origin, 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }
      ),
      params()
    );
  const post = (input: unknown, token = identity.ownerToken, origin = 'http://localhost:3000') =>
    route.POST(
      new NextRequest(`http://localhost:3000/api/v1/classes/${classId}/prerequisite`, {
        method: 'POST',
        headers: { cookie: `sotto_session=${token}`, origin, 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
      params()
    );
  const acknowledge = (
    input: unknown,
    token = identity.ownerToken,
    origin = 'http://localhost:3000'
  ) =>
    acknowledgmentRoute.POST(
      new NextRequest(`http://localhost:3000/api/v1/classes/${classId}/prerequisite/acknowledge`, {
        method: 'POST',
        headers: { cookie: `sotto_session=${token}`, origin, 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
      params()
    );

  const waitForReadyPrelude = () =>
    vi.waitFor(
      async () => {
        const value = classPreludeResponseSchema.parse(await (await getPrelude()).json());
        if (value.kind !== 'ADDENDUM' || value.status !== 'READY' || !value.receiptId)
          throw new Error('Prerequisite teaching is not ready');
        return { ...value, receiptId: value.receiptId };
      },
      { timeout: 15_000, interval: 50 }
    );

  it('keeps blocked, unprotected, and submitted focus snapshots distinct', async () => {
    const read = async () => {
      const response = await getFocusSnapshot();
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      const body: unknown = await response.json();
      expect(JSON.stringify(body)).not.toMatch(/PRIVATE_|CONCEALED_|correctIndex/);
      return classFocusSnapshotSchema.parse(body);
    };
    const blocked = await read();
    expect(blocked.prelude).toMatchObject({ kind: 'ADDENDUM', status: 'AVAILABLE' });
    expect(blocked.progress.status).toBe('IN_PROGRESS');
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    await instance.database.courseClass.create({
      data: {
        courseId: cls.courseId,
        lessonId: cls.lessonId,
        order: 0,
        status: 'PASSED',
        createdAt: new Date(0),
        skillRequirements: createSkillRequirements({
          scope: 'CLASS',
          nativeLang: 'es',
          targetLang: 'ru',
          level: 'A1',
          ttsProvider: null,
          sttProvider: null,
        }),
      },
    });
    const unprotected = await read();
    expect(unprotected.prelude).toEqual({ kind: 'NOT_REQUIRED' });
    expect(unprotected.progress.status).toBe('IN_PROGRESS');
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { status: 'SUBMITTED' },
    });
    const replay = await read();
    expect(replay.prelude).toEqual({ kind: 'REPLAY' });
    expect(replay.progress.status).toBe('SUBMITTED');
  });

  registerPrerequisiteReadCases(() => ({
    instance,
    identity,
    classId,
    classRoute,
    progressRecoveryRoute,
    focusSnapshotRoute,
    params,
    get,
    getPrelude,
    getFocusSnapshot,
    acknowledgePrelude,
    preparePrelude,
    post,
    calls,
  }));

  it('authenticates, deduplicates and retains teaching without exposing private answers', async () => {
    const initialResponse = await get();
    expect(initialResponse.status).toBe(200);
    expect(initialResponse.headers.get('cache-control')).toBe('private, no-store');
    const initial = classPrerequisiteResponseSchema.parse(await initialResponse.json());
    expect(initial.status).toBe('AVAILABLE');
    const [{ readPrerequisiteSource }, { sottoTransaction }] = await Promise.all([
      import('@/lib/classes/help/content/prerequisite-source'),
      import('@/lib/sidedoor/access/state/transaction'),
    ]);
    const privateSource = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    expect(initial.request.sourceHash).not.toBe(privateSource.sourceHash);
    expect(initial.request.snapshotHash).not.toBe(privateSource.hash);
    expect(
      (await post({ sourceHash: privateSource.sourceHash, snapshotHash: privateSource.hash }))
        .status
    ).toBe(409);
    expect(calls).toHaveLength(0);
    expect(
      (await preparePrelude(initial.request, identity.ownerToken, 'http://localhost:3000', true))
        .status
    ).toBe(409);
    expect(calls).toHaveLength(0);
    const initialPrelude = await getPrelude();
    expect(initialPrelude.headers.get('cache-control')).toBe('private, no-store');
    const initialPreludeValue = classPreludeResponseSchema.parse(await initialPrelude.json());
    expect(initialPreludeValue).toMatchObject({
      kind: 'ADDENDUM',
      status: 'AVAILABLE',
      request: initial.request,
    });
    const initialFocus = classFocusSnapshotSchema.parse(await (await getFocusSnapshot()).json());
    expect(initialFocus.prelude).toEqual(initialPreludeValue);
    expect(JSON.stringify(initialFocus)).not.toContain(privateSource.sourceHash);
    expect(JSON.stringify(initialFocus)).not.toContain(privateSource.hash);
    expect(
      await instance.database.$transaction((database) =>
        readClassTeachingPreludeInTransaction(database, classId, identity.ownerId)
      )
    ).toEqual(initialPreludeValue);
    expect(
      (await acknowledge({ sourceHash: initial.request.sourceHash, receiptId: randomUUID() }))
        .status
    ).toBe(409);
    expect(
      (await acknowledge({ sourceHash: initial.request.sourceHash, receiptId: 'invalid' })).status
    ).toBe(400);
    const other = await identity.household('Otro alumno');
    expect((await get(other.token)).status).toBe(409);
    expect(
      (await post(initial.request, identity.ownerToken, 'https://untrusted.example')).status
    ).toBe(403);
    expect((await post({ ...initial.request, sourceHash: '0'.repeat(64) })).status).toBe(409);
    expect(
      (await preparePrelude(initial.request, identity.ownerToken, 'https://untrusted.example'))
        .status
    ).toBe(403);
    const submissions = await Promise.all([post(initial.request), preparePrelude(initial.request)]);
    expect(submissions.map((item) => item.status)).toEqual([202, 202]);
    expect(classPreludeResponseSchema.parse(await submissions[1].json())).toMatchObject({
      kind: 'ADDENDUM',
      status: 'PENDING',
    });
    worker = runtime.createWorker('interactions', processor.processInteraction, { concurrency: 2 });
    await worker.waitUntilReady();
    const ready = await waitForReadyPrelude();
    expect(ready.acknowledged).toBe(false);
    expect(ready.content?.title).toBe('Pedir con cortesía');
    expect(ready.content?.explanation).toContain('«вопрос» significa pregunta');
    const legacyReady = await get();
    expect(legacyReady.status).toBe(409);
    expect(await legacyReady.json()).toEqual({
      error: 'Review the prerequisite teaching first.',
      code: 'PREREQUISITE_ACK_REQUIRED',
    });
    expect((await post(initial.request)).status).toBe(409);
    const { requireInitialA1PracticeAccess } =
      await import('@/lib/classes/lesson/initial-a1-provenance');
    const requirePractice = () =>
      instance.database.$transaction((database) =>
        requireInitialA1PracticeAccess(database, classId, identity.ownerId)
      );
    await expect(requirePractice()).rejects.toThrow('Review the prerequisite teaching');
    const submit = () =>
      submitClass(classId, identity.ownerId, [], authorizedLearnerExecution(identity.ownerId));
    await expect(submit()).rejects.toThrow('Review the prerequisite teaching');
    const readyPrelude = classPreludeResponseSchema.parse(await (await getPrelude()).json());
    const preparedReady = await preparePrelude(initial.request);
    expect(preparedReady.status).toBe(200);
    const preparedBody = JSON.stringify(await preparedReady.json());
    expect(preparedBody).not.toMatch(/PRIVATE_|CONCEALED_|correctIndex|directions/);
    expect(readyPrelude).toMatchObject({
      kind: 'ADDENDUM',
      status: 'READY',
      acknowledged: false,
      receiptId: ready.receiptId,
    });
    const preludeJson = JSON.stringify(readyPrelude);
    expect(readyPrelude).toMatchObject({ request: ready.request });
    expect(preludeJson).not.toContain(privateSource.sourceHash);
    expect(preludeJson).not.toContain(privateSource.hash);
    expect(preludeJson).not.toMatch(/PRIVATE_|CONCEALED_|correctIndex|directions/);
    expect((await getPrelude(other.token)).status).toBe(404);
    expect(
      (
        await acknowledgePrelude(
          { kind: 'ADDENDUM', receiptId: ready.receiptId },
          identity.ownerToken,
          'https://untrusted.example'
        )
      ).status
    ).toBe(403);
    expect((await acknowledgePrelude({ kind: 'ADDENDUM', receiptId: randomUUID() })).status).toBe(
      409
    );
    const progress = () =>
      progressRecoveryRoute.GET(
        new NextRequest(`http://localhost:3000/api/v1/classes/${classId}/progress-recovery`, {
          headers: { cookie: `sotto_session=${identity.ownerToken}` },
        }),
        params()
      );
    const beforeAcknowledgment = await (await progress()).json();
    expect(
      (await acknowledgePrelude({ kind: 'ADDENDUM', receiptId: ready.receiptId })).status
    ).toBe(200);
    const afterAcknowledgment = await (await progress()).json();
    const acknowledgedSnapshot = classFocusSnapshotSchema.parse(
      await (await getFocusSnapshot()).json()
    );
    expect(acknowledgedSnapshot.prelude).toMatchObject({
      kind: 'ADDENDUM',
      status: 'READY',
      receiptId: ready.receiptId,
      acknowledged: true,
    });
    expect(acknowledgedSnapshot.progress).toEqual(afterAcknowledgment);
    expect(afterAcknowledgment.taskMaterialRevision).not.toBe(
      beforeAcknowledgment.taskMaterialRevision
    );
    const detail = await classRoute.GET(
      new NextRequest(`http://localhost:3000/api/v1/classes/${classId}`, {
        headers: { cookie: `sotto_session=${identity.ownerToken}` },
      }),
      params()
    );
    expect((await detail.json()).taskMaterialRevision).toBe(
      afterAcknowledgment.taskMaterialRevision
    );
    const staleSave = await classRoute.PATCH(
      new NextRequest(`http://localhost:3000/api/v1/classes/${classId}`, {
        method: 'PATCH',
        headers: {
          cookie: `sotto_session=${identity.ownerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          expectedRevision: beforeAcknowledgment.progressRevision,
          expectedAttempt: beforeAcknowledgment.attempt,
          taskMaterialRevision: beforeAcknowledgment.taskMaterialRevision,
          answers: {},
        }),
      }),
      params()
    );
    expect(staleSave.status).toBe(409);
    expect(classPreludeResponseSchema.parse(await (await getPrelude()).json())).toMatchObject({
      kind: 'ADDENDUM',
      status: 'READY',
      acknowledged: true,
    });
    await expect(requirePractice()).resolves.toBeUndefined();
    await expect(submit()).rejects.toBeInstanceOf(ClassIncompleteError);
    const unlocked = classPrerequisiteResponseSchema.parse(await (await get()).json());
    expect(unlocked.content?.directions.tasks).toHaveLength(13);
    const acknowledgment = { sourceHash: ready.request.sourceHash, receiptId: ready.receiptId };
    expect((await acknowledge(acknowledgment, other.token)).status).toBe(409);
    expect(
      (await acknowledge(acknowledgment, identity.ownerToken, 'https://untrusted.example')).status
    ).toBe(403);
    expect((await acknowledge({ ...acknowledgment, receiptId: randomUUID() })).status).toBe(409);
    const acknowledged = await Promise.all([
      acknowledge(acknowledgment),
      acknowledge(acknowledgment),
    ]);
    expect(acknowledged.map((result) => result.status)).toEqual([200, 200]);
    for (const result of acknowledged) {
      expect(result.headers.get('cache-control')).toBe('private, no-store');
      expect(classPrerequisiteResponseSchema.parse(await result.json())).toMatchObject({
        status: 'READY',
        receiptId: ready.receiptId,
        acknowledged: true,
      });
    }
    expect((await post(initial.request)).status).toBe(200);
    expect(calls).toHaveLength(6);
    expect(calls.slice(0, 2).every((body) => body.includes('Преврати сообщение'))).toBe(true);
    expect(calls.join('\n')).not.toMatch(/PRIVATE_|CONCEALED_|correctIndex/);
    const directionRequests = calls.filter(
      (body) =>
        body.includes('Explain the action required for each supplied exercise') ||
        body.includes('Independently review each proposed direction')
    );
    expect(directionRequests).toHaveLength(4);
    expect(directionRequests.join('\n')).not.toContain('Чай, пожалуйста');
    expect(directionRequests.join('\n')).not.toContain('Un texto.');
    const saved = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    expect(saved.learnerAnswers).toEqual({ draft: 'PRIVATE_ANSWER' });
    expect(saved.writingDrafts).toEqual({ draft: 'PRIVATE_DRAFT' });
    await instance.database.lessonQuestion.updateMany({
      where: { section: { classId }, skill: 'GRAMMAR' },
      data: { question: 'Una pregunta nueva.' },
    });
    await expect(requirePractice()).rejects.toThrow('Review the prerequisite teaching');
    await expect(submit()).rejects.toThrow('Review the prerequisite teaching');
    expect((await acknowledge(acknowledgment)).status).toBe(409);
  });

  it('never acknowledges a replacement receipt using an older displayed explanation', async () => {
    const question = await instance.database.lessonQuestion.findFirstOrThrow({
      where: { section: { classId }, skill: 'GRAMMAR' },
      orderBy: { order: 'asc' },
    });
    worker = runtime.createWorker('interactions', processor.processInteraction, { concurrency: 2 });
    await worker.waitUntilReady();
    const prepare = async () => {
      const before = classPrerequisiteResponseSchema.parse(await (await get()).json());
      expect(['AVAILABLE', 'STALE']).toContain(before.status);
      expect((await post(before.request)).status).toBe(202);
      return waitForReadyPrelude();
    };
    const first = await prepare();
    const old = { sourceHash: first.request.sourceHash, receiptId: first.receiptId };
    expect((await acknowledge(old)).status).toBe(200);
    await instance.database.lessonQuestion.update({
      where: { id: question.id },
      data: { question: 'Otra pregunta.' },
    });
    await prepare();
    await instance.database.lessonQuestion.update({
      where: { id: question.id },
      data: { question: question.question },
    });
    const replacement = await prepare();
    expect(replacement.request.sourceHash).toBe(first.request.sourceHash);
    expect(replacement.receiptId).not.toBe(first.receiptId);
    expect(replacement.acknowledged).toBe(false);
    expect((await acknowledge(old)).status).toBe(409);
    expect(
      (
        await acknowledge({
          sourceHash: replacement.request.sourceHash,
          receiptId: replacement.receiptId,
        })
      ).status
    ).toBe(200);
  });

  it('invalidates acknowledgment when a question changes concurrently', async () => {
    const initial = classPrerequisiteResponseSchema.parse(await (await get()).json());
    expect((await post(initial.request)).status).toBe(202);
    worker = runtime.createWorker('interactions', processor.processInteraction, { concurrency: 2 });
    await worker.waitUntilReady();
    const ready = await waitForReadyPrelude();
    const acknowledgment = { sourceHash: ready.request.sourceHash, receiptId: ready.receiptId };
    const [result] = await Promise.all([
      acknowledge(acknowledgment),
      instance.database.lessonQuestion.updateMany({
        where: { section: { classId }, skill: 'GRAMMAR' },
        data: { question: 'La pregunta cambió.' },
      }),
    ]);
    expect([200, 409]).toContain(result.status);
    const after = classPrerequisiteResponseSchema.parse(await (await get()).json());
    expect(after.status).toBe('STALE');
    expect((await acknowledge(acknowledgment)).status).toBe(409);
    const saved = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    expect(saved.learnerAnswers).toEqual({ draft: 'PRIVATE_ANSWER' });
    expect(saved.writingDrafts).toEqual({ draft: 'PRIVATE_DRAFT' });
  });

  it('does not retain acknowledgment when its class is deleted concurrently', async () => {
    const initial = classPrerequisiteResponseSchema.parse(await (await get()).json());
    expect((await post(initial.request)).status).toBe(202);
    worker = runtime.createWorker('interactions', processor.processInteraction, { concurrency: 2 });
    await worker.waitUntilReady();
    const ready = await waitForReadyPrelude();
    const acknowledgment = { sourceHash: ready.request.sourceHash, receiptId: ready.receiptId };
    const [result, deletion] = await Promise.all([
      acknowledge(acknowledgment),
      classRoute.DELETE(
        new NextRequest(`http://localhost:3000/api/v1/classes/${classId}`, {
          method: 'DELETE',
          headers: {
            cookie: `sotto_session=${identity.ownerToken}`,
            origin: 'http://localhost:3000',
          },
        }),
        params()
      ),
    ]);
    expect([200, 409]).toContain(result.status);
    expect(deletion.status).toBe(200);
    expect(await instance.database.courseClass.findUnique({ where: { id: classId } })).toBeNull();
    expect((await acknowledge(acknowledgment)).status).toBe(409);
  });

  it('settles a changed lesson before making a provider request', async () => {
    const initial = classPrerequisiteResponseSchema.parse(await (await get()).json());
    expect((await post(initial.request)).status).toBe(202);
    await instance.database.lessonQuestion.updateMany({
      where: { section: { classId } },
      data: { question: 'Una pregunta modificada.' },
    });
    worker = runtime.createWorker('interactions', processor.processInteraction, { concurrency: 2 });
    await worker.waitUntilReady();
    await vi.waitFor(
      async () => {
        const value = classPrerequisiteResponseSchema.parse(await (await get()).json());
        expect(value.status).toBe('FAILED');
        expect(value.canRetry).toBe(true);
      },
      { timeout: 15_000, interval: 50 }
    );
    expect(calls).toEqual([]);
    expect((await post(initial.request)).status).toBe(409);
  });

  it('reports an oversized lesson before dispatching any provider request', async () => {
    const question = await instance.database.lessonQuestion.findFirstOrThrow({
      where: { section: { classId }, skill: 'GRAMMAR' },
    });
    await instance.database.lessonQuestion.update({
      where: { id: question.id },
      data: { question: 'a'.repeat(18_000) },
    });
    const initial = classPrerequisiteResponseSchema.parse(await (await get()).json());
    const response = await post(initial.request);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: 'This class is too large to prepare safely.',
    });
    expect(calls).toEqual([]);
  });

  it('does not publish partial directions when the class changes during authoring', async () => {
    changeOnDirection = true;
    const initial = classPrerequisiteResponseSchema.parse(await (await get()).json());
    expect((await post(initial.request)).status).toBe(202);
    worker = runtime.createWorker('interactions', processor.processInteraction, { concurrency: 2 });
    await worker.waitUntilReady();
    await vi.waitFor(
      async () => {
        const value = classPrerequisiteResponseSchema.parse(await (await get()).json());
        expect(value).toMatchObject({ status: 'FAILED', canRetry: true });
      },
      { timeout: 15_000, interval: 50 }
    );
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    expect(cls.adaptiveSeed).not.toHaveProperty('prerequisiteAddendum');
    expect(calls).toHaveLength(3);
    expect(cls.learnerAnswers).toEqual({ draft: 'PRIVATE_ANSWER' });
    expect(cls.writingDrafts).toEqual({ draft: 'PRIVATE_DRAFT' });
  });

  it('blocks another request after a provider connection is lost', async () => {
    loseConnection = true;
    const initial = classPrerequisiteResponseSchema.parse(await (await get()).json());
    expect((await post(initial.request)).status).toBe(202);
    worker = runtime.createWorker('interactions', processor.processInteraction, { concurrency: 2 });
    await worker.waitUntilReady();
    await vi.waitFor(
      async () => {
        const value = classPrerequisiteResponseSchema.parse(await (await get()).json());
        expect(value.status).toBe('UNRESOLVED');
      },
      { timeout: 15_000, interval: 50 }
    );
    const count = calls.length;
    expect(count).toBe(1);
    expect((await post(initial.request)).status).toBe(409);
    expect(calls).toHaveLength(count);
  });

  it('does not charge again for the same lesson after a conservative disclosure refusal', async () => {
    const question = await instance.database.lessonQuestion.findFirstOrThrow({
      where: { section: { classId }, skill: 'GRAMMAR' },
    });
    await instance.database.lessonQuestion.update({
      where: { id: question.id },
      data: { options: ['чай', 'вода', 'молоко', 'сок'], correctIndex: 0 },
    });
    unsafeCandidate = true;
    const initial = classPrerequisiteResponseSchema.parse(await (await get()).json());
    expect((await post(initial.request)).status).toBe(202);
    worker = runtime.createWorker('interactions', processor.processInteraction, { concurrency: 2 });
    await worker.waitUntilReady();
    let refused = initial;
    await vi.waitFor(
      async () => {
        refused = classPrerequisiteResponseSchema.parse(await (await get()).json());
        expect(refused).toMatchObject({ status: 'FAILED', failure: 'UNSAFE', canRetry: false });
      },
      { timeout: 15_000, interval: 50 }
    );
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(refused)).not.toContain('чай');
    expect((await post(refused.request)).status).toBe(409);
    const [{ sottoTransaction }, { admitPrerequisiteWork }, fenceModule, jobs] = await Promise.all([
      import('@/lib/sidedoor/access/state/transaction'),
      import('@/lib/classes/help/lifecycle/prerequisite-admission'),
      import('@/lib/classes/help/lifecycle/prerequisite-fence'),
      import('@/lib/sidedoor/jobs/core/job-delivery'),
    ]);
    const receipt = await sottoTransaction(instance.database, async (database) => {
      const fence = (
        await fenceModule
          .prerequisiteFenceStore(fenceModule.prerequisiteFenceBackend(database, classId))
          .read()
      ).current;
      if (!fence) throw new Error('Missing test fence');
      const record = await jobs.sottoJobOutbox(database).read(fence.id);
      if (!record) throw new Error('Missing test job');
      return {
        items: (await jobs.sottoJobSnapshot(database).read(fence.id, record.fingerprint, 0)).items,
        sourceHash: fence.sourceHash,
      };
    });
    expect(receipt.items).toEqual([
      { status: 'FAILED', sourceHash: receipt.sourceHash, failure: 'UNSAFE' },
    ]);
    expect(receipt.sourceHash).not.toBe(refused.request.sourceHash);
    expect(JSON.stringify(receipt)).not.toMatch(/чай|PRIVATE_|CONCEALED_/);
    await expect(
      sottoTransaction(instance.database, (database) =>
        admitPrerequisiteWork(database, {
          id: randomUUID(),
          revision: randomUUID(),
          classId,
          userId: identity.ownerId,
          expiresAt: Date.now() + 60_000,
          selection: {
            provider: 'different',
            model: 'different',
            credentialFingerprint: null,
            moderationCredentialFingerprint: null,
          },
          authorize: async () => ({ userId: identity.ownerId }),
        })
      )
    ).rejects.toThrow('already active or needs recovery');
    await instance.database.classSection.updateMany({
      where: { classId, skill: 'GRAMMAR' },
      data: { status: 'IN_PROGRESS' },
    });
    const progressed = classPrerequisiteResponseSchema.parse(await (await get()).json());
    expect(progressed).toMatchObject({ status: 'FAILED', failure: 'UNSAFE', canRetry: false });
    expect((await post(progressed.request)).status).toBe(409);
    await instance.database.lessonQuestion.update({
      where: { id: question.id },
      data: { question: 'Una pregunta nueva.' },
    });
    const changed = classPrerequisiteResponseSchema.parse(await (await get()).json());
    expect(changed).toMatchObject({ status: 'FAILED', failure: 'UNSAFE', canRetry: true });
    await worker.close();
    worker = undefined;
    expect((await post(changed.request)).status).toBe(202);
    expect(calls).toHaveLength(1);
    expect(calls.join('\n')).not.toMatch(/PRIVATE_|CONCEALED_/);
  });

  it('acknowledges a committed result after the worker loses its acknowledgement', async () => {
    const [transaction, learning, selectionTools, admission, source, generation, outcome] =
      await Promise.all([
        import('@/lib/sidedoor/access/state/transaction'),
        import('@/lib/learning-ai'),
        import('@/lib/classes/preparation-selection'),
        import('@/lib/classes/help/lifecycle/prerequisite-admission'),
        import('@/lib/classes/help/content/prerequisite-source'),
        import('@/lib/classes/help/content/prerequisite-generation'),
        import('@/lib/classes/help/prerequisite-outcome'),
      ]);
    const { sottoTransaction } = transaction;
    const { resolveCapturedLearningAi, captureLearningModerationCredential } = learning;
    const { learningCredentialFingerprint } = selectionTools;
    const { admitPrerequisiteWork } = admission;
    const { readPrerequisiteSource } = source;
    const { generatePrerequisiteAddendum } = generation;
    const { startPrerequisiteWork, publishPrerequisiteOutcome } = outcome;
    const initial = classPrerequisiteResponseSchema.parse(await (await get()).json());
    const execution = {
      userId: identity.ownerId,
      authorize: async () => ({ userId: identity.ownerId }),
    };
    const ai = await resolveCapturedLearningAi(identity.ownerId, execution);
    const moderation = await captureLearningModerationCredential(execution);
    const selection = {
      provider: ai.provider,
      model: ai.model,
      ...(ai.endpoint ? { endpoint: ai.endpoint } : {}),
      ...(ai.isolatedImage ? { isolatedImage: ai.isolatedImage } : {}),
      credentialFingerprint: learningCredentialFingerprint(ai.execution.credential),
      moderationCredentialFingerprint: learningCredentialFingerprint(moderation),
    };
    const captured = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    const record = await sottoTransaction(instance.database, (database) =>
      admitPrerequisiteWork(database, {
        id: randomUUID(),
        revision: randomUUID(),
        classId,
        userId: identity.ownerId,
        expiresAt: Date.now() + 60_000,
        selection,
        authorize: execution.authorize,
      })
    );
    const operation = { id: record.job.id, fingerprint: record.fingerprint };
    await sottoTransaction(instance.database, (database) =>
      startPrerequisiteWork(database, operation)
    );
    const workerExecution = { ...execution, learningSelection: selection };
    const content = await generatePrerequisiteAddendum(captured, workerExecution);
    await sottoTransaction(instance.database, (database) =>
      publishPrerequisiteOutcome(database, operation, workerExecution, content)
    );
    const pending = classPrerequisiteResponseSchema.parse(await (await get()).json());
    expect(pending).toMatchObject({ status: 'PENDING', recoverable: true });
    const previousCalls = [...calls];
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'rotated-prerequisite-test-key');
    expect((await preparePrelude(initial.request)).status).toBe(409);
    const refreshed = classPreludeResponseSchema.parse(await (await getPrelude()).json());
    if (refreshed.kind !== 'ADDENDUM') throw new Error('Missing saved prerequisite');
    expect(refreshed.request).not.toEqual(initial.request);
    const legacyRecovery = await post(refreshed.request);
    expect(legacyRecovery.status).toBe(409);
    expect(await legacyRecovery.json()).toMatchObject({ code: 'PREREQUISITE_ACK_REQUIRED' });
    // The first successful response may be lost after recovery commits.
    expect(
      (await preparePrelude(refreshed.request, identity.ownerToken, 'http://localhost:3000', true))
        .status
    ).toBe(200);
    const recovered = await preparePrelude(
      refreshed.request,
      identity.ownerToken,
      'http://localhost:3000',
      true
    );
    expect(recovered.status).toBe(200);
    expect(classPreludeResponseSchema.parse(await recovered.json())).toMatchObject({
      kind: 'ADDENDUM',
      status: 'READY',
      content: {
        title: content.title,
        explanation: content.explanation,
        examples: content.examples,
      },
    });
    expect(calls).toEqual(previousCalls);
  });
});
