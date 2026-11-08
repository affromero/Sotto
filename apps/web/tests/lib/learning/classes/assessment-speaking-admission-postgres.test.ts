// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { registerAssessmentSpeakingCases } from './assessment-speaking-cases/grading-cases';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSkillRequirements } from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import { authenticateRequest } from '@/lib/api-keys';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { READ_ALOUD_ASSESSMENT_RUBRIC } from '@/lib/learning/classes/speaking/assessment-speaking-policy';
import {
  assessmentMaterialDigest,
  parseAssessmentMaterial,
  type PrivateAssessmentMaterial,
} from '@/lib/learning/classes/material/assessment-material';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';
const boundary = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  task: null as unknown,
  onResolve: null as (() => void) | null,
  beforeWrite: null as (() => Promise<void>) | null,
  sttDispatches: 0,
  gradeDispatches: 0,
  failStt: false,
  failGrade: false,
  waitStt: null as (() => Promise<void>) | null,
  failCompletion: false,
  unsupportedAi: false,
  realTaskCapture: false,
}));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('@/lib/learning/classes/speaking/assessment-speaking-task', async (load) => {
  const actual =
    await load<typeof import('@/lib/learning/classes/speaking/assessment-speaking-task')>();
  return {
    ...actual,
    captureAssessmentSpeakingTask: async (
      ...args: Parameters<typeof actual.captureAssessmentSpeakingTask>
    ) =>
      boundary.realTaskCapture
        ? actual.captureAssessmentSpeakingTask(...args)
        : {
            task: boundary.task,
            taskDigest: 'b'.repeat(64),
            audioSource: null,
            speakingPolicy: 'READ_ALOUD_TRANSCRIPT_V1',
          },
  };
});
vi.mock('@/lib/providers/stt', async (load) => ({
  ...(await load<typeof import('@/lib/providers/stt')>()),
  resolveCapturedSttProvider: async ({
    execution,
  }: {
    execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution;
  }) => {
    boundary.onResolve?.();
    return {
      selection: {
        providerId: 'openai',
        model: 'fixture',
        baseUrl: null,
        credentialFingerprint: null,
      },
      provider: {
        transcribe: async () => {
          if (!execution.providerRequest) throw new Error('Missing provider request');
          await execution.providerRequest(new Request('https://fixture.test/stt'), async () => {
            boundary.sttDispatches += 1;
            await boundary.waitStt?.();
            if (boundary.failStt) throw new Error('Lost speech provider response');
            return Response.json({ text: 'Привет' });
          });
          return { text: 'Привет', words: [] };
        },
      },
    };
  },
}));
vi.mock('@/lib/learning-ai', () => ({
  captureLearningModerationCredential: async () => null,
  resolveCapturedLearningAi: async (_id: string, execution: unknown) => ({
    provider: 'fixture',
    model: 'fixture',
    execution,
  }),
  capturedLearningAiOptions: async () => ({}),
}));
vi.mock('@/lib/sidedoor/jobs/core/job-delivery', async (load) => {
  const actual = await load<typeof import('@/lib/sidedoor/jobs/core/job-delivery')>();
  return {
    ...actual,
    sottoJobOutbox: (database: Parameters<typeof actual.sottoJobOutbox>[0]) => {
      const outbox = actual.sottoJobOutbox(database);
      return new Proxy(outbox, {
        get(target, property) {
          if (property === 'complete')
            return (...args: Parameters<typeof target.complete>) => {
              if (boundary.failCompletion) throw new Error('Lost queue completion');
              return target.complete(...args);
            };
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
});
vi.mock('@/lib/providers/ai', async (load) => ({
  ...(await load<typeof import('@/lib/providers/ai')>()),
  aiProviderRules: () =>
    boundary.unsupportedAi ? [] : [{ origin: 'https://fixture.test', pathPrefix: '/' }],
}));
vi.mock('@/lib/sidedoor/credentials/runtime/provider-execution', async (load) => ({
  ...(await load<typeof import('@/lib/sidedoor/credentials/runtime/provider-execution')>()),
  createSottoProviderTransport: async (
    execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution
  ) => ({
    authenticatedFetch: async (request: RequestInfo | URL, init?: RequestInit) => {
      if (!execution.providerRequest) throw new Error('Missing provider request');
      return execution.providerRequest(new Request(request, init), async () => {
        boundary.gradeDispatches += 1;
        return Response.json({ result: 'scored' });
      });
    },
  }),
}));
vi.mock('@/lib/pronunciation/scorer', () => ({
  resolvePronunciationScorer: () => ({
    score: async (input: { transcript: string; fetch: typeof fetch }) => {
      await input.fetch('https://fixture.test/score');
      if (boundary.failGrade) throw new Error('Invalid grading result');
      return {
        transcript: input.transcript,
        overallScore: 0.8,
        rubricScores: { accuracy: 0.8, completeness: 0.8 },
        phonemeScores: [],
        feedback: 'Good',
      };
    },
  }),
}));
vi.mock('@/lib/sidedoor/storage/core/storage-write', async (load) => {
  const actual = await load<typeof import('@/lib/sidedoor/storage/core/storage-write')>();
  return {
    ...actual,
    writeStorageReference: async (options: Parameters<typeof actual.writeStorageReference>[0]) => {
      const writer = await actual.captureSottoStorageWriter();
      return actual.writeStorageReference({
        ...options,
        writer: {
          ...writer,
          write: async (...args) => {
            await boundary.beforeWrite?.();
            return writer.write(...args);
          },
        },
      });
    },
  };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('assessment speaking recording admission', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let executionRoot: string;
  let historicalMaterial: PrivateAssessmentMaterial;
  let generationId: string;
  let options: {
    request: Request;
    admission: NonNullable<Awaited<ReturnType<typeof authenticateRequest>>>;
    classId: string;
    assessmentId: string;
    promptId: string;
    requestId: string;
    audio: Uint8Array;
    extension: string;
    contentType: string;
  };
  beforeAll(async () => {
    instance = await createSharedTestInstance('assessment_speaking');
    boundary.database = instance.database;
    executionRoot = await mkdtemp(join(tmpdir(), 'sotto-assessment-speaking-'));
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
    await rm(executionRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'assessment-speaking-test-key');
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(executionRoot, 'executions'));
    identity = await instance.reset();
    boundary.onResolve = null;
    boundary.beforeWrite = null;
    boundary.sttDispatches = 0;
    boundary.gradeDispatches = 0;
    boundary.failStt = false;
    boundary.failGrade = false;
    boundary.waitStt = null;
    boundary.failCompletion = false;
    boundary.unsupportedAi = false;
    boundary.realTaskCapture = false;
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'ru' } },
      create: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
      update: {},
    });
    const lesson = await instance.database.lesson.upsert({
      where: { curriculumId_slug: { curriculumId: curriculum.id, slug: 'speaking-assessment' } },
      create: {
        curriculumId: curriculum.id,
        slug: 'speaking-assessment',
        level: 'A1',
        order: 1,
        title: 'First lesson',
        objective: 'Greet',
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
        nativeLang: 'es',
        targetLang: 'ru',
      },
    });
    const cls = await instance.database.courseClass.create({
      data: { courseId: course.id, lessonId: lesson.id, order: 1 },
    });
    const requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'es',
      targetLang: 'ru',
      level: 'A1',
      ttsProvider: null,
      sttProvider: 'openai',
    });
    generationId = randomUUID();
    const assessment = await instance.database.classAssessment.create({
      data: {
        classId: cls.id,
        courseId: course.id,
        userId: identity.ownerId,
        classAttempt: 1,
        assessmentAttempt: 1,
        requirements,
        formativeRevision: 'revision',
        generationOperationId: generationId,
      },
    });
    const section = await instance.database.classAssessmentSection.create({
      data: { assessmentId: assessment.id, skill: 'SPEAKING', passThreshold: 0.7 },
    });
    const speakingRequirement = requirements.skills.SPEAKING;
    if (speakingRequirement.state !== 'REQUIRED') throw new Error('Speaking is required');
    const prompts = [];
    for (let index = 0; index < speakingRequirement.expectedCount; index += 1)
      prompts.push(
        await instance.database.speakingPrompt.create({
          data: {
            assessmentSectionId: section.id,
            assessmentTaskMode: 'READ_ALOUD',
            order: index + 1,
            targetPhrase: `Привет ${index}`,
            translation: 'Hola',
            assessmentRubric: READ_ALOUD_ASSESSMENT_RUBRIC,
            assessmentGuidance: 'Lee la frase.',
          },
        })
      );
    const prompt = prompts[0]!;
    historicalMaterial = parseAssessmentMaterial({
      version: 1,
      id: assessment.id,
      classId: cls.id,
      courseId: course.id,
      userId: identity.ownerId,
      classAttempt: 1,
      assessmentAttempt: 1,
      formativeRevision: 'revision',
      requirements,
      sections: [
        {
          id: section.id,
          skill: 'SPEAKING',
          passThreshold: 0.7,
          items: prompts.map((entry) => ({
            id: entry.id,
            task: entry.targetPhrase,
            mode: 'READ_ALOUD',
            referenceAudioId: null,
            privateTranslation: 'Hola',
            privateRubric: READ_ALOUD_ASSESSMENT_RUBRIC,
            privateGuidance: 'Lee la frase.',
            privateIpa: null,
            privateLearningObjectives: null,
          })),
        },
      ],
    });
    const materialDigest = assessmentMaterialDigest(historicalMaterial);
    await instance.database.classAssessment.update({
      where: { id: assessment.id },
      data: {
        status: 'READY',
        teachingKind: 'BASE',
        teachingReceiptId: randomUUID(),
        reviewOperationId: randomUUID(),
        reviewedMaterialDigest: materialDigest,
        reviewReceipt: {},
        sealedAt: new Date(),
      },
    });
    boundary.task = {
      assessmentId: assessment.id,
      materialVersion: 1,
      classId: cls.id,
      courseId: course.id,
      userId: identity.ownerId,
      classAttempt: 1,
      assessmentAttempt: 1,
      materialDigest,
      sectionId: section.id,
      requirements,
      prompt: {
        id: prompt.id,
        task: prompt.targetPhrase,
        mode: 'READ_ALOUD',
        referenceAudioId: null,
        privateTranslation: 'Hola',
        privateRubric: READ_ALOUD_ASSESSMENT_RUBRIC,
        privateGuidance: 'Lee la frase.',
        privateIpa: null,
        privateLearningObjectives: null,
      },
    };
    const request = new Request('http://localhost/api/assessment/speaking', {
      method: 'POST',
      headers: { cookie: `sotto_session=${identity.ownerToken}` },
    });
    const admission = await authenticateRequest(request);
    if (!admission) throw new Error('Missing test session');
    options = {
      request,
      admission,
      classId: cls.id,
      assessmentId: assessment.id,
      promptId: prompt.id,
      requestId: randomUUID(),
      audio: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      extension: 'webm',
      contentType: 'audio/webm',
    };
  });
  function synchronizeWrites() {
    let arrived = 0;
    let release!: () => void;
    let fail!: (error: Error) => void;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const bothArrived = new Promise<void>((resolve, reject) => {
      fail = reject;
      release = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
    boundary.beforeWrite = async () => {
      arrived += 1;
      if (arrived === 1)
        timeout = setTimeout(() => fail(new Error('Both storage writes did not arrive')), 5000);
      if (arrived === 2) release();
      await bothArrived;
    };
  }
  it('retains one recording and replays only the exact submitted bytes', async () => {
    const { admitAssessmentSpeaking } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
    const first = await admitAssessmentSpeaking(options);
    expect(await admitAssessmentSpeaking(options)).toEqual(first);
    await expect(
      admitAssessmentSpeaking({ ...options, audio: new Uint8Array([1, 2, 3]) })
    ).rejects.toThrow();
    await expect(
      admitAssessmentSpeaking({ ...options, requestId: randomUUID() })
    ).rejects.toThrow();
    expect(
      await instance.database.speakingRecording.count({
        where: { assessmentSectionId: (boundary.task as { sectionId: string }).sectionId },
      })
    ).toBe(1);
    const record = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).read(first.operationId)
    );
    expect(record?.job).toMatchObject({ handler: 'speaking-grading', version: 3 });
  });
  it('accepts an owned multipart upload through the assessment route and replays it', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    const delivery = await import('@/lib/sidedoor/jobs/core/job-delivery');
    const deliver = vi.spyOn(delivery, 'deliverSottoJob').mockResolvedValue('delivered');
    try {
      const { POST } =
        await import('@/app/api/v1/classes/[classId]/assessment/[assessmentId]/speaking/[promptId]/route');
      const params = {
        params: Promise.resolve({
          classId: options.classId,
          assessmentId: options.assessmentId,
          promptId: options.promptId,
        }),
      };
      const upload = () => {
        const form = new FormData();
        form.append('requestId', options.requestId);
        form.append(
          'audio',
          new Blob([Uint8Array.from(options.audio)], { type: 'audio/pretend' }),
          'recording'
        );
        return POST(
          new NextRequest('http://localhost:3000/api/assessment/speaking', {
            method: 'POST',
            headers: {
              cookie: `sotto_session=${identity.ownerToken}`,
              origin: 'http://localhost:3000',
            },
            body: form,
          }),
          params
        );
      };
      const first = await upload();
      expect(first.status).toBe(202);
      expect(await first.json()).toEqual({ status: 'RUNNING', requestId: options.requestId });
      const replay = await upload();
      expect(replay.status).toBe(202);
      expect(await replay.json()).toEqual({ status: 'RUNNING', requestId: options.requestId });
      expect(
        await instance.database.speakingRecording.count({ where: { id: options.requestId } })
      ).toBe(1);
      expect(
        (
          await instance.database.speakingRecording.findUniqueOrThrow({
            where: { id: options.requestId },
          })
        ).audioUrl
      ).toMatch(/\.webm$/);
      const form = new FormData();
      form.append('requestId', randomUUID());
      form.append('audio', new Blob([Uint8Array.from(options.audio)]), 'recording.webm');
      const crossOrigin = await POST(
        new NextRequest('http://localhost:3000/api/assessment/speaking', {
          method: 'POST',
          headers: {
            cookie: `sotto_session=${identity.ownerToken}`,
            origin: 'https://attacker.example',
          },
          body: form,
        }),
        params
      );
      expect(crossOrigin.status).toBe(403);
      const forgedBearer = await POST(
        new NextRequest('http://localhost:3000/api/assessment/speaking', {
          method: 'POST',
          headers: {
            cookie: `sotto_session=${identity.ownerToken}`,
            authorization: 'Bearer invalid',
          },
          body: form,
        }),
        params
      );
      expect(forgedBearer.status).toBe(401);
      expect(
        await instance.database.speakingRecording.count({
          where: { assessmentSectionId: (boundary.task as { sectionId: string }).sectionId },
        })
      ).toBe(1);
    } finally {
      deliver.mockRestore();
    }
  });
  it('reads only the owned speaking status without exposing the recording or feedback', async () => {
    const { admitAssessmentSpeaking } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
    const { readAssessmentSpeakingStatus } =
      await import('@/lib/learning/classes/speaking/lifecycle/assessment-speaking-recovery');
    const execution = sottoRequestExecution(options.request, options.admission);
    const input = {
      classId: options.classId,
      assessmentId: options.assessmentId,
      promptId: options.promptId,
      execution,
    };
    const read = () =>
      sottoTransaction(instance.database, (tx) => readAssessmentSpeakingStatus(tx, input));
    expect(await read()).toEqual({ status: 'NOT_STARTED' });
    const admitted = await admitAssessmentSpeaking(options);
    expect(await read()).toEqual({ status: 'RUNNING', requestId: admitted.id });
    const { GET } =
      await import('@/app/api/v1/classes/[classId]/assessment/[assessmentId]/speaking/[promptId]/route');
    const response = await GET(
      new NextRequest('http://localhost/api/assessment/speaking', {
        headers: { cookie: `sotto_session=${identity.ownerToken}` },
      }),
      { params: Promise.resolve(input) }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ status: 'RUNNING', requestId: admitted.id });
    const other = await identity.household('Another learner');
    const foreignResponse = await GET(
      new NextRequest('http://localhost/api/assessment/speaking', {
        headers: { cookie: `sotto_session=${other.token}` },
      }),
      { params: Promise.resolve(input) }
    );
    expect(foreignResponse.status).toBe(409);
    expect(await foreignResponse.json()).not.toHaveProperty('status');
    const { assessmentSpeakingGradingPayloadSchema } =
      await import('@/lib/sidedoor/jobs/stitch/speaking-grading-work');
    const { learningPreparationGrant } =
      await import('@/lib/learning/preparation/preparation-grant');
    await sottoTransaction(instance.database, async (tx) => {
      const record = await sottoJobOutbox(tx).read(admitted.operationId);
      if (!record) throw new Error('Missing speaking job');
      const payload = assessmentSpeakingGradingPayloadSchema.parse(record.job.payload);
      await learningPreparationGrant(
        tx,
        {
          id: admitted.operationId,
          userId: identity.ownerId,
          courseId: payload.assessment.courseId,
        },
        'speaking'
      ).revoke(payload.grant);
    });
    expect(await read()).toEqual({ status: 'UNRESOLVED', requestId: admitted.id });
    await instance.database.speakingRecording.update({
      where: { id: admitted.id },
      data: {
        status: 'UNRESOLVED',
        feedback: 'private feedback',
        transcript: 'private transcript',
      },
    });
    expect(await read()).toEqual({ status: 'UNRESOLVED', requestId: admitted.id });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        readAssessmentSpeakingStatus(tx, {
          ...input,
          execution: {
            userId: 'another-user',
            authorize: async () => ({ userId: 'another-user' }),
          },
        })
      )
    ).rejects.toThrow();
  });
  it('refuses status when the real assessment capture cannot verify its owner or generation', async () => {
    boundary.realTaskCapture = true;
    const { GET } =
      await import('@/app/api/v1/classes/[classId]/assessment/[assessmentId]/speaking/[promptId]/route');
    const params = {
      classId: options.classId,
      assessmentId: options.assessmentId,
      promptId: options.promptId,
    };
    const request = (token: string) =>
      new NextRequest('http://localhost/api/assessment/speaking', {
        headers: { cookie: `sotto_session=${token}` },
      });
    const owner = await GET(request(identity.ownerToken), { params: Promise.resolve(params) });
    expect(owner.status).toBe(409);
    const other = await identity.household('Another learner');
    const foreign = await GET(request(other.token), { params: Promise.resolve(params) });
    expect(foreign.status).toBe(409);
    expect(await foreign.json()).not.toHaveProperty('status');
  });
  it('concurrent exact requests retain one recording and return the same work', async () => {
    const { admitAssessmentSpeaking } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
    synchronizeWrites();
    const results = await Promise.allSettled([
      admitAssessmentSpeaking(options),
      admitAssessmentSpeaking(options),
    ]);
    expect(results[0]?.status).toBe('fulfilled');
    expect(results[1]?.status).toBe('fulfilled');
    if (results[0]?.status !== 'fulfilled' || results[1]?.status !== 'fulfilled')
      throw new Error('Both exact requests must succeed');
    expect(results[0].value).toEqual(results[1].value);
    expect(
      await instance.database.speakingRecording.count({ where: { id: options.requestId } })
    ).toBe(1);
  });
  it('rejects one of two concurrent recordings for the same assessment prompt', async () => {
    const { admitAssessmentSpeaking } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
    synchronizeWrites();
    const results = await Promise.allSettled([
      admitAssessmentSpeaking(options),
      admitAssessmentSpeaking({ ...options, requestId: randomUUID() }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      await instance.database.speakingRecording.count({
        where: { assessmentSectionId: (boundary.task as { sectionId: string }).sectionId },
      })
    ).toBe(1);
  });
  it('rejects concurrent reuse of a request ID with different audio', async () => {
    const { admitAssessmentSpeaking } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
    synchronizeWrites();
    const results = await Promise.allSettled([
      admitAssessmentSpeaking(options),
      admitAssessmentSpeaking({ ...options, audio: new Uint8Array([1, 2, 3]) }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      await instance.database.speakingRecording.count({ where: { id: options.requestId } })
    ).toBe(1);
  });

  it('rejects a changed reviewed task before publishing the recording', async () => {
    const { admitAssessmentSpeaking } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
    boundary.onResolve = () => {
      boundary.task = { ...(boundary.task as object), materialDigest: 'd'.repeat(64) };
    };
    await expect(admitAssessmentSpeaking(options)).rejects.toThrow();
    expect(
      await instance.database.speakingRecording.count({ where: { id: options.requestId } })
    ).toBe(0);
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(options.requestId))
    ).toBeNull();
  });

  registerAssessmentSpeakingCases(() => ({
    instance,
    identity,
    options,
    boundary,
    generationId,
    historicalMaterial,
  }));

  it.skipIf(!process.env.SOTTO_TEST_PRIVATE_REDIS_URL).each(['intact', 'altered'] as const)(
    'reconciles a failed queue delivery after the speaking grade was saved (%s)',
    async (mode) => {
      const { Queue, Worker, UnrecoverableError } = await import('bullmq');
      const { admitAssessmentSpeaking } =
        await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
      const { processSpeakingGrading } = await import('@/workers/speaking-grading.worker');
      const { reconcileSottoJobs } = await import('@/lib/sidedoor/jobs/core/job-reconciliation');
      const admitted = await admitAssessmentSpeaking(options);
      const redis = new URL(process.env.SOTTO_TEST_PRIVATE_REDIS_URL!);
      const connection = {
        host: redis.hostname,
        port: Number(redis.port),
        maxRetriesPerRequest: null,
      };
      const prefix = `assessment-speaking-test-${randomUUID()}`;
      const queue = new Queue('speaking-grading', { connection, prefix });
      const worker = new Worker(
        queue.name,
        async (job) => {
          try {
            await processSpeakingGrading(job);
          } catch {
            throw new UnrecoverableError('Synthetic terminal delivery failure');
          }
        },
        { connection, prefix, autorun: false }
      );
      try {
        boundary.failCompletion = true;
        const job = await queue.add(
          'speaking-grading.v3',
          { operationId: admitted.operationId, fingerprint: admitted.fingerprint },
          { jobId: admitted.operationId, attempts: 3, priority: 0 }
        );
        void worker.run();
        await expect.poll(() => job.getState(), { timeout: 10000 }).toBe('failed');
        await worker.close();
        boundary.failCompletion = false;
        expect(
          await instance.database.speakingRecording.findUnique({ where: { id: admitted.id } })
        ).toMatchObject({ status: 'SCORED', overallScore: 0.8 });
        if (mode === 'altered')
          await instance.database.speakingRecording.update({
            where: { id: admitted.id },
            data: { feedback: 'Changed after grading' },
          });
        const result = await reconcileSottoJobs({
          database: instance.database,
          queues: new Map([[queue.name, queue]]),
          signal: AbortSignal.timeout(30_000),
          cursor: null,
        });
        const recovered = result.results.find((item) => item.id === admitted.operationId);
        if (mode === 'intact') {
          if (recovered?.status === 'failed') throw recovered.error;
          expect(recovered).toMatchObject({ status: 'complete' });
        } else {
          expect(recovered).toMatchObject({ status: 'failed' });
          expect(
            (
              await sottoTransaction(instance.database, (tx) =>
                sottoJobOutbox(tx).read(admitted.operationId)
              )
            )?.complete
          ).toBe(false);
        }
        expect(boundary.sttDispatches).toBe(1);
        expect(boundary.gradeDispatches).toBe(1);
      } finally {
        boundary.failCompletion = false;
        await worker.close();
        await queue.obliterate({ force: true });
        await queue.close();
      }
    }
  );

  it('does not recover a changed grade or repeat paid work after queue completion fails', async () => {
    const { admitAssessmentSpeaking } =
      await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
    const { processAssessmentSpeaking } =
      await import('@/workers/classes/assessment-speaking.worker');
    const admitted = await admitAssessmentSpeaking(options);
    const job = {
      id: admitted.operationId,
      name: 'speaking-grading.v3',
      data: { operationId: admitted.operationId, fingerprint: admitted.fingerprint },
    } as import('bullmq').Job<unknown>;
    boundary.failCompletion = true;
    await expect(processAssessmentSpeaking(job, AbortSignal.timeout(30_000))).rejects.toThrow();
    boundary.failCompletion = false;
    await instance.database.speakingRecording.update({
      where: { id: admitted.id },
      data: { feedback: 'Changed after grading' },
    });
    await expect(processAssessmentSpeaking(job, AbortSignal.timeout(30_000))).rejects.toThrow();
    expect(boundary.sttDispatches).toBe(1);
    expect(boundary.gradeDispatches).toBe(1);
    const record = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).read(admitted.operationId)
    );
    expect(record?.complete).toBe(false);
  });

  it.skipIf(!process.env.SOTTO_TEST_PRIVATE_REDIS_URL).each(['terminal', 'retry_race'] as const)(
    'fences a terminal prelaunch failure without discarding audio (%s)',
    async (mode) => {
      const { Queue, Worker, UnrecoverableError } = await import('bullmq');
      const { admitAssessmentSpeaking } =
        await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
      const { processAssessmentSpeaking } =
        await import('@/workers/classes/assessment-speaking.worker');
      const { reconcileFailedAssessmentSpeakingPrelaunch } =
        await import('@/lib/learning/classes/speaking/lifecycle/assessment-speaking-prelaunch');
      const admitted = await admitAssessmentSpeaking(options);
      const originalTask = boundary.task;
      boundary.task = { ...(boundary.task as object), materialDigest: 'd'.repeat(64) };
      const redis = new URL(process.env.SOTTO_TEST_PRIVATE_REDIS_URL!);
      const connection = {
        host: redis.hostname,
        port: Number(redis.port),
        maxRetriesPerRequest: null,
      };
      const prefix = `assessment-speaking-test-${randomUUID()}`;
      const queue = new Queue('speaking-grading', { connection, prefix });
      const worker = new Worker(
        queue.name,
        async (job) => {
          try {
            await processAssessmentSpeaking(job, AbortSignal.timeout(30_000));
          } catch {
            throw new UnrecoverableError('Synthetic terminal worker failure');
          }
        },
        { connection, prefix, autorun: false }
      );
      let restoreCommand = () => {};
      try {
        const queued = await queue.add(
          'speaking-grading.v3',
          {
            operationId: admitted.operationId,
            fingerprint: admitted.fingerprint,
          },
          { jobId: admitted.operationId, attempts: 3, priority: 0 }
        );
        const reconcile = () =>
          reconcileFailedAssessmentSpeakingPrelaunch({
            database: instance.database,
            queue,
            identity: { id: admitted.operationId, fingerprint: admitted.fingerprint },
            signal: AbortSignal.timeout(30_000),
          });
        await expect(reconcile()).rejects.toThrow();
        void worker.run();
        await expect.poll(() => queued.getState(), { timeout: 10000 }).toBe('failed');
        await worker.close();
        const client = await queue.getBackend().client;
        const original = client.runCommand.bind(client);
        restoreCommand = () => {
          client.runCommand = original;
        };
        if (mode === 'retry_race') {
          client.runCommand = async (name, args) => {
            const result = await original(name, args);
            if (name === 'sottoFailedDeliverySnapshotV1') {
              await queued.retry();
              boundary.task = originalTask;
              await processAssessmentSpeaking(queued, AbortSignal.timeout(30_000));
            }
            return result;
          };
        }
        const outcome =
          mode === 'terminal'
            ? (
                await (
                  await import('@/lib/sidedoor/jobs/core/job-reconciliation')
                ).reconcileSottoJobs({
                  database: instance.database,
                  queues: new Map([[queue.name, queue]]),
                  signal: AbortSignal.timeout(30_000),
                  cursor: null,
                })
              ).results.find((item) => item.id === admitted.operationId)?.status === 'complete'
            : await reconcile();
        restoreCommand();
        const { assessmentSpeakingPrelaunchReceiptId } =
          await import('@/lib/learning/classes/speaking/lifecycle/assessment-speaking-prelaunch-receipt');
        const receipt = await instance.database.sidedoorState.findUnique({
          where: { id: assessmentSpeakingPrelaunchReceiptId(admitted.operationId) },
        });
        if (mode === 'retry_race') {
          expect(receipt).toBeNull();
          expect(outcome).toBe(false);
          expect(
            await instance.database.speakingRecording.findUnique({ where: { id: admitted.id } })
          ).toMatchObject({ status: 'SCORED' });
          expect(
            (
              await sottoTransaction(instance.database, (tx) =>
                sottoJobOutbox(tx).read(admitted.operationId)
              )
            )?.complete
          ).toBe(true);
          return;
        }
        expect(outcome).toBe(true);
        expect(receipt?.state).toMatchObject({
          version: 1,
          operationId: admitted.operationId,
          fingerprint: admitted.fingerprint,
          recordingId: admitted.id,
          assessmentId: options.assessmentId,
          classId: options.classId,
          userId: identity.ownerId,
          deliveryAttempts: expect.any(Number),
          processedAt: expect.any(Number),
          failedAt: expect.any(Number),
        });
        const recording = await instance.database.speakingRecording.findUniqueOrThrow({
          where: { id: admitted.id },
        });
        expect(recording).toMatchObject({ status: 'FAILED' });
        expect(recording.audioUrl).toBeTruthy();
        expect(boundary.sttDispatches).toBe(0);
        expect(boundary.gradeDispatches).toBe(0);
        expect(
          (
            await sottoTransaction(instance.database, (tx) =>
              sottoJobOutbox(tx).read(admitted.operationId)
            )
          )?.complete
        ).toBe(true);
        boundary.task = originalTask;
        const { verifyAssessmentSpeakingForDeletion } =
          await import('@/lib/learning/classes/speaking/lifecycle/assessment-speaking-deletion');
        const verification = {
          classId: options.classId,
          courseId: historicalMaterial.courseId,
          userId: identity.ownerId,
          assessmentId: options.assessmentId,
          recordingId: admitted.id,
          operationId: admitted.operationId,
          fingerprint: admitted.fingerprint,
        };
        await expect(
          sottoTransaction(instance.database, (tx) =>
            verifyAssessmentSpeakingForDeletion(tx, verification)
          )
        ).resolves.toBeUndefined();
        const { readAssessmentSpeakingStatus } =
          await import('@/lib/learning/classes/speaking/lifecycle/assessment-speaking-recovery');
        const readStatus = () =>
          sottoTransaction(instance.database, (tx) =>
            readAssessmentSpeakingStatus(tx, {
              classId: options.classId,
              assessmentId: options.assessmentId,
              promptId: options.promptId,
              execution: sottoRequestExecution(options.request, options.admission),
            })
          );
        expect(await readStatus()).toEqual({ status: 'FAILED', requestId: admitted.id });
        const requests = [
          { ...options, requestId: randomUUID() },
          { ...options, requestId: randomUUID() },
        ];
        synchronizeWrites();
        const retries = await Promise.allSettled(requests.map(admitAssessmentSpeaking));
        expect(retries.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const winner = retries.findIndex((result) => result.status === 'fulfilled');
        const result = retries[winner];
        if (result?.status !== 'fulfilled') throw new Error('Missing accepted retry');
        const replacement = result.value;
        boundary.beforeWrite = null;
        expect(replacement.id).not.toBe(admitted.id);
        expect(await readStatus()).toEqual({ status: 'RUNNING', requestId: replacement.id });
        expect(await admitAssessmentSpeaking(requests[winner]!)).toEqual(replacement);
        expect(await admitAssessmentSpeaking(options)).toMatchObject({
          id: admitted.id,
          status: 'FAILED',
        });
        await expect(
          admitAssessmentSpeaking({ ...options, requestId: randomUUID() })
        ).rejects.toThrow();
        expect(
          await instance.database.speakingRecording.findUnique({ where: { id: admitted.id } })
        ).toMatchObject({ status: 'FAILED' });
        await processAssessmentSpeaking(
          {
            id: replacement.operationId,
            name: 'speaking-grading.v3',
            data: { operationId: replacement.operationId, fingerprint: replacement.fingerprint },
          } as import('bullmq').Job<unknown>,
          AbortSignal.timeout(30_000)
        );
        expect(await readStatus()).toEqual({ status: 'COMPLETED', requestId: replacement.id });
        const { captureAssessmentSpeakingEvidence } =
          await import('@/lib/learning/classes/speaking/assessment-speaking-evidence');
        const evidence = () =>
          sottoTransaction(instance.database, (tx) =>
            captureAssessmentSpeakingEvidence(tx, {
              classId: options.classId,
              assessmentId: options.assessmentId,
              promptId: options.promptId,
              execution: sottoRequestExecution(options.request, options.admission),
            })
          );
        expect(await evidence()).toMatchObject({ recordingId: replacement.id });
        await instance.database.sidedoorState.delete({
          where: { id: assessmentSpeakingPrelaunchReceiptId(admitted.operationId) },
        });
        await expect(
          sottoTransaction(instance.database, (tx) =>
            verifyAssessmentSpeakingForDeletion(tx, verification)
          )
        ).rejects.toThrow();
        await expect(readStatus()).rejects.toThrow();
        await expect(evidence()).rejects.toThrow();
      } finally {
        restoreCommand();
        await worker.close();
        await queue.obliterate({ force: true });
        await queue.close();
      }
    }
  );
});
