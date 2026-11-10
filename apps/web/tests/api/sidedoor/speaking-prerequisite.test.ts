// @vitest-environment private-redis
import { randomUUID } from 'node:crypto';
import { registerSpeakingCleanupCases } from './speaking-cases/cleanup-cases';
import { registerSpeakingRecoveryCases } from './speaking-cases/recovery-cases';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { authenticateRequest } from '@/lib/api-keys';
import { initialA1MaterialHash } from '@/lib/classes/lesson/initial-a1-provenance';
import { classProgressRevision } from '@/lib/learning/classes/progress/progress-revision';
import { createSpeakingRecording } from '@/lib/sidedoor/storage/publication/speaking-recording-upload';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { classSpeakingGradingPayloadSchema } from '@/lib/sidedoor/jobs/stitch/speaking-grading-work';
import { sampleTeaching } from '../../helpers/learning/class-teaching';
import { relocateStorageFixture } from '../../helpers/runtime/relocate-storage';
import { processSpeakingGrading } from '@/workers/speaking-grading.worker';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { inspectSpeakingGradingDeletion } from '@/lib/sidedoor/jobs/stitch/speaking-grading-deletion';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { captureStorageBackend } from '@/lib/r2';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { deleteClassForUser } from '@/lib/class-service';
import { type Job } from 'bullmq';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import { StorageReferenceRegistry } from 'thesidedoor-core/storage';
import { settleFailedClassSpeaking } from '@/lib/sidedoor/jobs/stitch/speaking-grading-failure';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { hasFormativeSpeakingReceipt } from '@/lib/learning/classes/practice/assessment-practice-speaking';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  resolve: null as (() => Promise<void>) | null,
  afterTranscription: null as (() => Promise<void>) | null,
}));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('@/lib/providers/stt', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/stt')>()),
  resolveCapturedSttProvider: async ({
    execution,
  }: {
    execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution;
  }) => {
    await boundary.resolve?.();
    return {
      selection: {
        providerId: 'openai',
        model: 'fixture',
        baseUrl: null,
        credentialFingerprint: null,
      },
      provider: {
        transcribe: async (
          _audio: Buffer,
          options: { onDispatch: () => void; onSettled: () => void }
        ) => {
          if (!execution.providerRequest) throw new Error('Missing durable provider admission');
          await execution.providerRequest(
            new Request('https://provider.example/transcribe', { method: 'POST', body: 'audio' }),
            async () => {
              options.onDispatch();
              options.onSettled();
              return new Response('ok');
            }
          );
          await boundary.afterTranscription?.();
          return { text: 'Hola', words: [] };
        },
      },
    };
  },
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async (_userId: string, execution: unknown) => ({
    provider: 'fixture-cli',
    model: 'fixture',
    endpoint: '',
    apiKey: '',
    execution,
  }),
  capturedLearningAiOptions: async () => ({}),
}));
vi.mock('@/lib/providers/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/ai')>()),
  aiProviderRules: () => [],
}));
vi.mock('@/lib/pronunciation/scorer', () => ({
  resolvePronunciationScorer: () => ({
    score: async () => ({
      transcript: 'Hola',
      overallScore: 1,
      rubricScores: {},
      phonemeScores: [],
      feedback: 'Good',
    }),
  }),
}));

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('speaking upload prerequisite admission', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let classId: string;
  let sectionId: string;
  let promptId: string;
  let request: Request;
  beforeAll(async () => {
    instance = await createSharedTestInstance('speaking_gate');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'speaking-prerequisite-test-key');
    identity = await instance.reset();
    boundary.resolve = null;
    boundary.afterTranscription = null;
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'es' } },
      create: { nativeLang: 'en', targetLang: 'es', title: 'Spanish' },
      update: {},
    });
    const lesson = await instance.database.lesson.upsert({
      where: { curriculumId_slug: { curriculumId: curriculum.id, slug: 'speaking-gate' } },
      create: {
        curriculumId: curriculum.id,
        slug: 'speaking-gate',
        level: 'A1',
        order: 1,
        title: 'Greetings',
        objective: 'Greet a person',
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
        targetLang: 'es',
      },
    });
    const cls = await instance.database.courseClass.create({
      data: {
        courseId: course.id,
        lessonId: lesson.id,
        order: 1,
        status: 'AVAILABLE',
        adaptiveSeed: { teaching: sampleTeaching },
        skillRequirements: createSkillRequirements({
          scope: 'CLASS',
          nativeLang: 'en',
          targetLang: 'es',
          level: 'A1',
          ttsProvider: null,
          sttProvider: 'openai',
        }),
      },
    });
    classId = cls.id;
    sectionId = (
      await instance.database.classSection.create({
        data: { classId, skill: 'SPEAKING', status: 'READY', seed: 'fixture', spec: {} },
      })
    ).id;
    promptId = (
      await instance.database.speakingPrompt.create({
        data: { sectionId, order: 1, targetPhrase: 'Hola', translation: 'Hello' },
      })
    ).id;
    request = new Request('http://localhost/api/speaking', {
      method: 'POST',
      headers: { cookie: `sotto_session=${identity.ownerToken}` },
    });
  });
  afterAll(async () => {
    boundary.database = null;
    await instance.close();
    vi.unstubAllEnvs();
  });

  async function gate(acknowledged: boolean) {
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const materialHash = await initialA1MaterialHash(instance.database, classId, identity.ownerId);
    const receiptId = randomUUID();
    const receipt = {
      version: 1,
      classId,
      courseId: cls.courseId,
      userId: identity.ownerId,
      attempt: 1,
      receiptId,
      materialHash,
      ...(acknowledged
        ? { acknowledgment: { userId: identity.ownerId, receiptId, materialHash } }
        : {}),
    };
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { prerequisiteGate: receipt },
    });
    return receipt;
  }
  async function classBinding() {
    return instance.database.$transaction(async (database) => {
      const cls = await database.courseClass.findUniqueOrThrow({ where: { id: classId } });
      const revision = await classProgressRevision(database, classId, identity.ownerId);
      return { classId, expectedAttempt: cls.attempt, taskMaterialRevision: revision.revision };
    });
  }
  async function upload(binding?: Awaited<ReturnType<typeof classBinding>>) {
    const admission = await authenticateRequest(request);
    if (!admission) throw new Error('Missing test session');
    return createSpeakingRecording({
      request,
      admission,
      promptId,
      parent: { sectionId },
      classBinding: binding ?? (await classBinding()),
      audio: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      extension: 'webm',
      contentType: 'audio/webm',
    });
  }

  it('blocks an unacknowledged first lesson before publishing audio or a grading job', async () => {
    await gate(false);
    await expect(upload()).rejects.toThrow('Review the prerequisite teaching');
    expect(await instance.database.speakingRecording.count()).toBe(0);
  });

  it('binds newly published reference audio to its class generation', async () => {
    const admission = await authenticateRequest(request);
    if (!admission) throw new Error('Missing test session');
    const { publishSpeakingPromptReferences } = await import('@/lib/class-speaking-generator');
    const references = await publishSpeakingPromptReferences({
      userId: identity.ownerId,
      execution: sottoRequestExecution(request, admission),
      required: true,
      prompts: [
        {
          id: promptId,
          composed: {
            targetPhrase: 'Hola',
            translation: 'Hello',
            ipa: null,
            referenceTtsAudio: new Uint8Array([1, 2, 3]),
          },
        },
      ],
    });
    const reference = references.get(promptId);
    if (!reference) throw new Error('Missing reference audio');
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const asset = await sottoTransaction(instance.database, (database) =>
      new StorageReferenceRegistry(
        {
          query: (sql, values) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      ).resolve({ consumer: `speaking-prompt:${promptId}:reference`, reference })
    );
    expect(asset?.prepared.scopes).toContainEqual({
      subjectId: `class:${classId}`,
      generation: cls.createdAt.getTime(),
    });
  });

  it('recovers interrupted reference-only class cleanup for the original owner', async () => {
    const admission = await authenticateRequest(request);
    if (!admission) throw new Error('Missing test session');
    const { publishSpeakingPromptReferences } = await import('@/lib/class-speaking-generator');
    const references = await publishSpeakingPromptReferences({
      userId: identity.ownerId,
      execution: sottoRequestExecution(request, admission),
      required: true,
      prompts: [
        {
          id: promptId,
          composed: {
            targetPhrase: 'Hola',
            translation: 'Hello',
            ipa: null,
            referenceTtsAudio: new Uint8Array([1, 2, 3]),
          },
        },
      ],
    });
    const reference = references.get(promptId);
    if (!reference) throw new Error('Missing reference audio');
    const storage = await captureStorageBackend();
    const runtime = await import('@/lib/sidedoor/storage/migration/storage-cleanup-runtime');
    const { openSottoStorageConnection } =
      await import('@/lib/sidedoor/storage/core/storage-connection');
    const runCleanup = runtime.runSottoStorageCleanup;
    const cleanup = vi
      .spyOn(runtime, 'runSottoStorageCleanup')
      .mockRejectedValueOnce(new Error('Synthetic cleanup interruption'))
      .mockImplementation((database, jobId, options) =>
        runCleanup(database, jobId, {
          ...options,
          openConnection: () =>
            openSottoStorageConnection(process.env.SIDEDOOR_TEST_DATABASE_URL, instance.schema),
        })
      );
    const ownerExecution = {
      userId: identity.ownerId,
      authorize: async () => ({ userId: identity.ownerId }),
    };
    try {
      expect(await deleteClassForUser(classId, identity.ownerId, ownerExecution)).toBe(true);
      expect(await storage.has(storage.normalize(reference))).toBe(true);
      const { eraseCompletedClassCleanupReceipts } =
        await import('@/lib/classes/help/prerequisite-deletion');
      await expect(
        sottoTransaction(instance.database, (database) =>
          eraseCompletedClassCleanupReceipts(database, identity.ownerId)
        )
      ).rejects.toThrow('Finish pending class cleanup');
      const other = await instance.database.user.create({
        data: { email: `${randomUUID()}@example.test` },
      });
      expect(
        await deleteClassForUser(classId, other.id, {
          userId: other.id,
          authorize: async () => ({ userId: other.id }),
        })
      ).toBe(false);
      expect(await storage.has(storage.normalize(reference))).toBe(true);
      expect(await deleteClassForUser(classId, identity.ownerId, ownerExecution)).toBe(true);
      expect(await storage.has(storage.normalize(reference))).toBe(false);
      await sottoTransaction(instance.database, (database) =>
        eraseCompletedClassCleanupReceipts(database, identity.ownerId)
      );
      expect(
        await instance.database.sidedoorState.findFirst({
          where: { id: `${SIDEDOOR_STATE_ID}:class-cleanup:${classId}` },
        })
      ).toBeNull();
    } finally {
      cleanup.mockRestore();
    }
  });

  it('rejects an old recording binding after the acknowledged receipt changes', async () => {
    await gate(true);
    const original = await classBinding();
    await gate(true);
    let providerAdmission = false;
    boundary.resolve = async () => {
      providerAdmission = true;
    };
    await expect(upload(original)).rejects.toThrow(
      'The class changed before the recording was accepted'
    );
    expect(providerAdmission).toBe(false);
    expect(await instance.database.speakingRecording.count()).toBe(0);
  });

  it('rejects an incorrect class attempt before resolving the speech provider', async () => {
    await gate(true);
    const binding = await classBinding();
    let providerAdmission = false;
    boundary.resolve = async () => {
      providerAdmission = true;
    };
    await expect(
      upload({ ...binding, expectedAttempt: binding.expectedAttempt + 1 })
    ).rejects.toThrow('The class changed before the recording was accepted');
    expect(providerAdmission).toBe(false);
    expect(await instance.database.speakingRecording.count()).toBe(0);
  });

  it('rejects a recording when the class finishes before admission', async () => {
    await gate(true);
    const binding = await classBinding();
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { status: 'PASSED' },
    });
    await expect(upload(binding)).rejects.toThrow(
      'The class changed before the recording was accepted'
    );
    expect(await instance.database.speakingRecording.count()).toBe(0);
  });

  it('rejects a recording from a superseded speaking section', async () => {
    await gate(true);
    const binding = await classBinding();
    await instance.database.classSection.create({
      data: { classId, skill: 'SPEAKING', attempt: 2, status: 'READY', seed: 'new', spec: {} },
    });
    await expect(upload(binding)).rejects.toThrow(
      'The class changed before the recording was accepted'
    );
    expect(await instance.database.speakingRecording.count()).toBe(0);
  });

  it('rejects a receipt change while the speech provider is being resolved', async () => {
    await gate(true);
    const binding = await classBinding();
    boundary.resolve = async () => {
      await gate(true);
    };
    await expect(upload(binding)).rejects.toThrow(
      'The class changed before the recording was accepted'
    );
    expect(await instance.database.speakingRecording.count()).toBe(0);
  });

  it('publishes the submitted audio even if the caller changes its buffer during admission', async () => {
    await gate(true);
    const admission = await authenticateRequest(request);
    if (!admission) throw new Error('Missing test session');
    const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
    boundary.resolve = async () => {
      audio.fill(0);
    };
    const recording = await createSpeakingRecording({
      request,
      admission,
      promptId,
      parent: { sectionId },
      classBinding: await classBinding(),
      audio,
      extension: 'webm',
      contentType: 'audio/webm',
    });
    const directory = await mkdtemp(join(tmpdir(), 'sotto-speaking-upload-'));
    try {
      const path = join(directory, 'recording.webm');
      const backend = await captureStorageBackend();
      await backend.downloadToFile(recording.audioUrl, path);
      expect(await readFile(path)).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects an assessment prompt through the ordinary class recording admission', async () => {
    await gate(true);
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const assessment = await instance.database.classAssessment.create({
      data: {
        classId,
        courseId: cls.courseId,
        userId: identity.ownerId,
        classAttempt: cls.attempt,
        assessmentAttempt: 1,
        requirements: {},
        formativeRevision: 'revision',
      },
    });
    const section = await instance.database.classAssessmentSection.create({
      data: { assessmentId: assessment.id, skill: 'SPEAKING', passThreshold: 0.7 },
    });
    const assessmentPrompt = await instance.database.speakingPrompt.create({
      data: {
        assessmentSectionId: section.id,
        assessmentTaskMode: 'READ_ALOUD',
        order: 1,
        targetPhrase: 'Hola',
        translation: 'Hello',
        assessmentRubric: 'Pronounce the greeting',
      },
    });
    const admission = await authenticateRequest(request);
    if (!admission) throw new Error('Missing test session');
    await expect(
      createSpeakingRecording({
        request,
        admission,
        promptId: assessmentPrompt.id,
        parent: { sectionId },
        classBinding: await classBinding(),
        audio: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
        extension: 'webm',
        contentType: 'audio/webm',
      })
    ).rejects.toThrow('The class changed before the recording was accepted');
    expect(await instance.database.speakingRecording.count()).toBe(0);
  });

  it('binds an acknowledged receipt to the committed recording and grading job', async () => {
    const receipt = await gate(true);
    const recording = await upload();
    expect(
      await instance.database.speakingRecording.findUniqueOrThrow({ where: { id: recording.id } })
    ).toMatchObject({ status: 'PENDING', promptId });
    const job = await instance.database.$transaction((database) =>
      sottoJobOutbox(database).read(recording.operationId)
    );
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const asset = await sottoTransaction(instance.database, (database) =>
      new StorageReferenceRegistry(
        {
          query: (sql, values) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      ).resolve({ consumer: `recording:${recording.id}:audio`, reference: recording.audioUrl })
    );
    expect(asset?.prepared.scopes).toContainEqual({
      subjectId: `class:${classId}`,
      generation: cls.createdAt.getTime(),
    });
    const payload = classSpeakingGradingPayloadSchema.parse(job?.job.payload);
    expect(payload.classAuthorization).toEqual({
      classId,
      authorization: {
        kind: 'BASE',
        receiptId: receipt.receiptId,
        materialHash: receipt.materialHash,
      },
    });
    const parent = payload.ownership.associations.parents.find(
      (candidate) => candidate.kind === 'class'
    );
    if (!parent) throw new Error('Missing class ownership');
    const grant = await instance.database.$transaction((database) =>
      learningPreparationGrant(
        database,
        {
          id: recording.operationId,
          userId: identity.ownerId,
          courseId: parent.courseId,
        },
        'speaking'
      ).read(payload.grant)
    );
    expect(grant.attempts).toEqual([]);
    expect(grant.status).toBe('active');
  });

  it('admits only one concurrent class recording for the same prompt', async () => {
    await gate(true);
    const results = await Promise.allSettled([upload(), upload()]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await instance.database.speakingRecording.count({ where: { promptId } })).toBe(1);
    await expect(upload()).rejects.toThrow('previous recording is still grading or needs recovery');
  });

  it('rejects a replacement receipt before storage publication', async () => {
    await gate(true);
    boundary.resolve = async () => {
      await gate(true);
    };
    await expect(upload()).rejects.toThrow('The class changed before the recording was accepted');
    expect(await instance.database.speakingRecording.count()).toBe(0);
  });

  it('rejects queued grading if the learner acknowledged a replacement receipt', async () => {
    await gate(true);
    const recording = await upload();
    const queued = await instance.database.$transaction((database) =>
      sottoJobOutbox(database).read(recording.operationId)
    );
    const payload = classSpeakingGradingPayloadSchema.parse(queued?.job.payload);
    const parent = payload.ownership.associations.parents.find(
      (candidate) => candidate.kind === 'class'
    );
    if (!parent) throw new Error('Missing class ownership');
    await gate(true);
    const job = {
      id: recording.operationId,
      name: 'speaking-grading.v2',
      data: { operationId: recording.operationId, fingerprint: recording.fingerprint },
      updateProgress: vi.fn(),
    } as unknown as Job<unknown>;
    await processSpeakingGrading(job);
    expect(
      await instance.database.speakingRecording.findUniqueOrThrow({ where: { id: recording.id } })
    ).toMatchObject({ status: 'FAILED', transcript: null, overallScore: null });
    expect(
      await instance.database.$transaction((database) =>
        sottoJobOutbox(database).receipt(recording.operationId)
      )
    ).toMatchObject({ status: 'complete' });
    const grant = await instance.database.$transaction((database) =>
      learningPreparationGrant(
        database,
        { id: recording.operationId, userId: identity.ownerId, courseId: parent.courseId },
        'speaking'
      ).read(payload.grant)
    );
    expect(grant).toMatchObject({ status: 'revoked', attempts: [] });
  });

  it('rejects queued grading when the speaking task changes after acknowledgment', async () => {
    await gate(true);
    const recording = await upload();
    await instance.database.speakingPrompt.update({
      where: { id: promptId },
      data: { translation: 'A different task' },
    });
    const job = {
      id: recording.operationId,
      name: 'speaking-grading.v2',
      data: { operationId: recording.operationId, fingerprint: recording.fingerprint },
      updateProgress: vi.fn(),
    } as unknown as Job<unknown>;
    await processSpeakingGrading(job);
    expect(
      await instance.database.speakingRecording.findUniqueOrThrow({ where: { id: recording.id } })
    ).toMatchObject({ status: 'FAILED', transcript: null, overallScore: null });
  });

  it('does not dispatch a queued recording again after an admitted provider attempt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sotto-speaking-attempt-'));
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(directory, 'executions'));
    try {
      await gate(true);
      const recording = await upload();
      const jobRecord = await instance.database.$transaction((database) =>
        sottoJobOutbox(database).read(recording.operationId)
      );
      const payload = classSpeakingGradingPayloadSchema.parse(jobRecord?.job.payload);
      const parent = payload.ownership.associations.parents.find(
        (candidate) => candidate.kind === 'class'
      );
      if (!parent) throw new Error('Missing class ownership');
      const grantContext = {
        id: recording.operationId,
        userId: identity.ownerId,
        courseId: parent.courseId,
      };
      const attempt = { id: randomUUID(), fingerprint: 'a'.repeat(64) };
      await instance.database.$transaction((database) =>
        learningPreparationGrant(database, grantContext, 'speaking').admit(payload.grant, attempt)
      );
      let providerCalled = false;
      boundary.resolve = async () => {
        providerCalled = true;
      };
      const job = {
        id: recording.operationId,
        name: 'speaking-grading.v2',
        data: { operationId: recording.operationId, fingerprint: recording.fingerprint },
        updateProgress: vi.fn(),
      } as unknown as Job<unknown>;
      for (let index = 0; index < 2; index++) await processSpeakingGrading(job);
      expect(providerCalled).toBe(false);
      const grant = await instance.database.$transaction((database) =>
        learningPreparationGrant(database, grantContext, 'speaking').read(payload.grant)
      );
      expect(grant).toMatchObject({
        status: 'revoked',
        attempts: [{ id: attempt.id, outcome: 'admitted' }],
      });
      expect(
        await instance.database.speakingRecording.findUniqueOrThrow({ where: { id: recording.id } })
      ).toMatchObject({ status: 'UNRESOLVED', transcript: null, overallScore: null });
      await expect(upload()).rejects.toThrow(
        'previous recording is still grading or needs recovery'
      );
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('marks exhausted work without provider attempts as safely failed', async () => {
    await gate(true);
    const recording = await upload();
    const observation = {
      operationId: recording.operationId,
      fingerprint: recording.fingerprint,
      handler: 'speaking-grading',
      version: 2,
      state: 'failed',
    };
    await sottoTransaction(instance.database, (database) =>
      settleFailedClassSpeaking(database, observation)
    );
    expect(
      await instance.database.speakingRecording.findUniqueOrThrow({ where: { id: recording.id } })
    ).toMatchObject({ status: 'FAILED', audioUrl: expect.any(String), transcript: null });
    expect(
      await instance.database.$transaction((database) =>
        sottoJobOutbox(database).receipt(recording.operationId)
      )
    ).toMatchObject({ status: 'complete' });
  });

  registerSpeakingRecoveryCases(() => ({
    instance,
    identity,
    classId,
    promptId,
    request,
    gate,
    upload,
    boundary,
  }));

  it('preserves listening audio while its job is pending or ownership has changed', async () => {
    const episode = await instance.database.episode.create({
      data: { userId: identity.ownerId, title: 'Listening', topic: 'Practice', source: 'CLASS' },
    });
    await instance.database.classSection.create({
      data: {
        classId,
        skill: 'LISTENING',
        attempt: 1,
        status: 'READY',
        seed: 'listening',
        spec: {},
        episodeId: episode.id,
      },
    });
    const job = await sottoTransaction(instance.database, async (database) => {
      const ownership = await captureEpisodeStorage(database, episode.id);
      return sottoJobOutbox(database).enqueue(
        prepareJob({
          namespace: SIDEDOOR_STATE_ID,
          handler: 'audio-generation',
          version: 1,
          payload: {},
          scopes: ownership.scopes,
          delivery: { attempts: 1, priority: 0, availableAt: 0 },
        })
      );
    });
    const execution = {
      userId: identity.ownerId,
      authorize: async () => ({ userId: identity.ownerId }),
    };
    await expect(deleteClassForUser(classId, identity.ownerId, execution)).rejects.toThrow(
      'active or requires recovery'
    );
    await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).complete(job.job.id, job.fingerprint)
    );
    await instance.database.episode.update({ where: { id: episode.id }, data: { source: 'WEB' } });
    await expect(deleteClassForUser(classId, identity.ownerId, execution)).rejects.toThrow(
      'active or requires recovery'
    );
    const other = await identity.household('Other learner');
    await instance.database.episode.update({
      where: { id: episode.id },
      data: { userId: other.id, source: 'CLASS' },
    });
    await expect(deleteClassForUser(classId, identity.ownerId, execution)).rejects.toThrow(
      'active or requires recovery'
    );
    expect(
      await instance.database.courseClass.findUnique({ where: { id: classId } })
    ).not.toBeNull();
    expect(
      await instance.database.episode.findUnique({ where: { id: episode.id } })
    ).not.toBeNull();
  });

  registerSpeakingCleanupCases(() => ({ instance, identity, classId, sectionId, gate, upload }));

  it('records provider attempts and completes the grant with the published score', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sotto-speaking-success-'));
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(directory, 'executions'));
    try {
      const teaching = await gate(true);
      const recording = await upload();
      const jobRecord = await instance.database.$transaction((database) =>
        sottoJobOutbox(database).read(recording.operationId)
      );
      const payload = classSpeakingGradingPayloadSchema.parse(jobRecord?.job.payload);
      const parent = payload.ownership.associations.parents.find(
        (candidate) => candidate.kind === 'class'
      );
      if (!parent) throw new Error('Missing class ownership');
      const verifyIn = async (
        database: Prisma.TransactionClient,
        override?: { userId?: string; receiptId?: string }
      ) => {
        const saved = await database.speakingRecording.findUniqueOrThrow({
          where: { id: recording.id },
        });
        const prompt = await database.speakingPrompt.findUniqueOrThrow({
          where: { id: promptId },
        });
        return hasFormativeSpeakingReceipt(database, {
          recording: saved,
          prompt,
          classId,
          courseId: parent.courseId,
          userId: override?.userId ?? identity.ownerId,
          authorization: {
            kind: 'BASE',
            receiptId: override?.receiptId ?? teaching.receiptId,
            materialHash: teaching.materialHash,
          },
        });
      };
      const verify = (override?: { userId?: string; receiptId?: string }) =>
        sottoTransaction(instance.database, (database) => verifyIn(database, override));
      expect(await verify()).toBe(false);
      const course = await instance.database.course.findUniqueOrThrow({
        where: { id: parent.courseId },
      });
      const subject = {
        subjectId: `course:${parent.courseId}`,
        generation: course.createdAt.getTime(),
      };
      await expect(
        sottoTransaction(instance.database, (database) =>
          inspectSpeakingGradingDeletion(database, [subject])
        )
      ).rejects.toThrow('active or requires recovery');
      const job = {
        id: recording.operationId,
        name: 'speaking-grading.v2',
        data: { operationId: recording.operationId, fingerprint: recording.fingerprint },
        updateProgress: vi.fn(),
      } as unknown as Job<unknown>;
      await processSpeakingGrading(job);
      const grant = await instance.database.$transaction((database) =>
        learningPreparationGrant(
          database,
          { id: recording.operationId, userId: identity.ownerId, courseId: parent.courseId },
          'speaking'
        ).read(payload.grant)
      );
      expect(grant.status).toBe('completed');
      expect(grant.attempts.map((attempt) => attempt.outcome)).toEqual(['succeeded', 'succeeded']);
      expect(
        await instance.database.speakingRecording.findUniqueOrThrow({ where: { id: recording.id } })
      ).toMatchObject({ status: 'SCORED', transcript: 'Hola', overallScore: 1 });
      expect(await verify()).toBe(true);
      expect(await verify({ userId: 'another-learner' })).toBe(false);
      expect(await verify({ receiptId: randomUUID() })).toBe(false);
      const authorityRows = await instance.database.$queryRaw<{ id: string }[]>`
        SELECT id FROM "SidedoorState"
        WHERE (id LIKE 'sd-j:1:%' AND id LIKE ${`%:${recording.operationId}`})
           OR (id LIKE 'sd-jeg:1:%' AND id LIKE ${`%:${recording.operationId}`})
           OR (state->>'kind' = 'job_execution' AND state->>'parentId' = ${recording.operationId})
           OR id LIKE ${`%:speaking-grant:${recording.operationId}`}`;
      expect(authorityRows).toHaveLength(4);
      for (const row of authorityRows) {
        const started = Promise.withResolvers<void>();
        const resume = Promise.withResolvers<void>();
        const stale = instance.database
          .$transaction(
            async (database) => {
              await database.courseClass.findUniqueOrThrow({ where: { id: classId } });
              started.resolve();
              await resume.promise;
              return verifyIn(database);
            },
            { isolationLevel: 'Serializable', timeout: 15000 }
          )
          .then(
            () => null,
            (error: unknown) => error
          );
        await started.promise;
        try {
          await instance.database.$executeRaw`
            UPDATE "SidedoorState" SET revision = revision WHERE id = ${row.id}`;
        } finally {
          resume.resolve();
        }
        expect(isSerializationConflict(await stale), row.id).toBe(true);
      }
      const savedRecording = await instance.database.speakingRecording.findUniqueOrThrow({
        where: { id: recording.id },
      });
      await instance.database.speakingRecording.update({
        where: { id: recording.id },
        data: { audioUrl: '/different-recording.webm' },
      });
      expect(await verify()).toBe(false);
      await instance.database.speakingRecording.update({
        where: { id: recording.id },
        data: { audioUrl: savedRecording.audioUrl },
      });
      expect(await verify()).toBe(true);
      const backend = await captureStorageBackend();
      if (backend.descriptor.kind !== 'local') throw new Error('Expected local storage');
      const moved = await relocateStorageFixture({
        database: instance.database,
        directory: backend.descriptor.identity.root,
        reference: savedRecording.audioUrl,
        consumers: [`recording:${recording.id}:audio`],
        publish: (database, audioUrl) =>
          database.speakingRecording.update({ where: { id: recording.id }, data: { audioUrl } }),
      });
      expect(await verify()).toBe(true);
      const proofRows = await instance.database.$queryRaw<{ id: string }[]>`
        SELECT id FROM "SidedoorState"
        WHERE state->>'kind' = 'storage_relocation' OR id LIKE 'sd-rels:1:%'`;
      expect(proofRows).toHaveLength(2);
      for (const row of proofRows) {
        const started = Promise.withResolvers<void>();
        const resume = Promise.withResolvers<void>();
        const stale = instance.database
          .$transaction(
            async (database) => {
              await database.courseClass.findUniqueOrThrow({ where: { id: classId } });
              started.resolve();
              await resume.promise;
              return verifyIn(database);
            },
            { isolationLevel: 'Serializable', timeout: 15000 }
          )
          .then(
            () => null,
            (error: unknown) => error
          );
        await started.promise;
        try {
          await instance.database.$executeRaw`
            UPDATE "SidedoorState" SET revision = revision WHERE id = ${row.id}`;
        } finally {
          resume.resolve();
        }
        expect(isSerializationConflict(await stale), row.id).toBe(true);
      }
      const movedAgain = await relocateStorageFixture({
        database: instance.database,
        directory: backend.descriptor.identity.root,
        reference: moved,
        consumers: [`recording:${recording.id}:audio`],
        publish: (database, audioUrl) =>
          database.speakingRecording.update({ where: { id: recording.id }, data: { audioUrl } }),
      });
      expect(await verify()).toBe(true);
      await relocateStorageFixture({
        database: instance.database,
        directory: backend.descriptor.identity.root,
        reference: movedAgain,
        consumers: [`recording:${recording.id}:audio`],
        recordProof: false,
        publish: (database, audioUrl) =>
          database.speakingRecording.update({ where: { id: recording.id }, data: { audioUrl } }),
      });
      expect(await verify()).toBe(false);
      await expect(
        sottoTransaction(instance.database, async (database) => {
          await admitLearningStorageDeletion({
            database,
            scope: { kind: 'course', id: parent.courseId, episodeIds: [] },
            subjects: [subject],
            currentBackend: backend,
          });
          await database.course.delete({ where: { id: parent.courseId } });
        })
      ).rejects.toThrow('Storage relocation has no verified copy for deletion');
      expect(
        await instance.database.course.findUnique({ where: { id: parent.courseId } })
      ).not.toBeNull();
      expect(
        await instance.database.$transaction((database) =>
          sottoJobOutbox(database).receipt(recording.operationId)
        )
      ).toMatchObject({ status: 'complete', fingerprint: recording.fingerprint });
      expect(
        await instance.database.sidedoorState.findUnique({
          where: { id: `${SIDEDOOR_STATE_ID}:speaking-grant:${recording.operationId}` },
        })
      ).not.toBeNull();
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
