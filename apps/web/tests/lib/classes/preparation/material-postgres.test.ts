// @vitest-environment node
import { createSkillRequirements } from '@sotto/shared';
import { createRepairTarget } from './material-cases/repair-target';
import { registerSpeakingCleanupCases } from './material-cases/speaking-cleanup';
import { registerRepairFinalizationCases } from './material-cases/repair-finalization';
import { registerRepairConcurrencyCases } from './material-cases/repair-concurrency';
import { registerRepairPublicationCases } from './material-cases/repair-publication';
import { registerRetainedHistoryCases } from './material-cases/retained-history';
import { setSiteConfig } from '@/lib/site-config';
import { randomBytes, randomUUID } from 'node:crypto';
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

import {
  requestClassPreparation,
  classPreparationStore,
  recordClassPreparationFailure,
  validateClassPreparation,
} from '@/lib/classes/preparation';

import { processClassPreparation } from '@/workers/classes/class-preparation.worker';
import { speakingRepairSourceHash } from '@/lib/classes/repair/speaking-repair-source';
import {
  StorageBackendRegistry,
  StorageReferenceRegistry,
  prepareStorageBackend,
  prepareStorageReference,
  storageBackendBinding,
} from 'thesidedoor-core/storage';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import {
  encryptSpeakingReference,
  speakingReferenceWrappingKey,
} from '@/lib/classes/speaking/speaking-reference-crypto';
import { currentClassSections } from '@/lib/learning/classes/progress/current-sections';
import {
  activateStagedSpeaking,
  sealClassSpeaking,
  stageClassSpeaking,
  verifySpeakingReferenceStage,
} from '@/lib/classes/staging/staged-speaking';

import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';
const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
const providerBoundary = vi.hoisted(() => ({ generate: null as null | ReturnType<typeof vi.fn> }));
vi.mock('@/lib/providers/ai', async (load) => {
  const actual = await load<typeof import('@/lib/providers/ai')>();
  return {
    ...actual,
    createAIProvider: (...args: Parameters<typeof actual.createAIProvider>) => {
      const provider = actual.createAIProvider(...args);
      return providerBoundary.generate
        ? {
            generateResponse: providerBoundary.generate,
            streamResponse: provider.streamResponse.bind(provider),
          }
        : provider;
    },
  };
});
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('complete class material and retained repair', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let courseId: string;
  let execution: SottoProviderExecution;
  let executionDirectory: string;
  let temporaryRoot: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('preparation_material');
    boundary.database = instance.database;
    temporaryRoot = await mkdtemp(join(tmpdir(), 'preparation-parent-test-'));
    executionDirectory = join(temporaryRoot, 'executions');
  });
  beforeEach(async () => {
    providerBoundary.generate = null;
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
  registerSpeakingCleanupCases(() => ({ instance, identity, courseId, execution, repairTarget }));

  it('freezes text skills and genuine speech exemptions before a queued worker runs', async () => {
    const admitted = await requestClassPreparation(courseId, execution);
    expect(admitted.requirements).toMatchObject({
      scope: 'CLASS',
      nativeLang: 'en',
      targetLang: 'de',
      level: 'A1',
      skills: {
        GRAMMAR: { state: 'REQUIRED', expectedCount: 5 },
        READING: { state: 'REQUIRED', expectedCount: 5 },
        WRITING: { state: 'REQUIRED', expectedCount: 3 },
      },
    });
    expect(admitted.speechFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect((await classPreparationStore(instance.database, courseId).read())?.requirements).toEqual(
      admitted.requirements
    );
  });

  it('rejects changed admitted course context before another provider request', async () => {
    const admitted = await running();
    await instance.database.course.update({
      where: { id: courseId },
      data: { currentLevel: 'B1' },
    });
    await expect(
      sottoTransaction(instance.database, (database) =>
        validateClassPreparation(database, courseId, admitted.id)
      )
    ).rejects.toThrow(/language or level changed/);
  });

  it('does not waive a frozen listening requirement when its provider changes', async () => {
    await setSiteConfig(
      { ttsProvider: 'local', ttsBaseUrl: 'http://localhost:9001', sttProvider: null },
      identity.ownerId
    );
    const admitted = await running();
    expect(admitted.requirements?.skills.LISTENING.state).toBe('REQUIRED');
    await setSiteConfig({ ttsProvider: 'cartesia' }, identity.ownerId);
    await expect(
      sottoTransaction(instance.database, (database) =>
        validateClassPreparation(database, courseId, admitted.id)
      )
    ).rejects.toThrow();
    expect(
      (await classPreparationStore(instance.database, courseId).read())?.requirements?.skills
        .LISTENING.state
    ).toBe('REQUIRED');
  });

  const repairTarget = () => createRepairTarget(instance, identity, courseId);

  it('binds speaking repair to the saved prompt and recording evidence', async () => {
    const { cls } = await repairTarget();
    const section = await instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill: 'SPEAKING',
        seed: 'saved-speech',
        spec: {},
        status: 'READY',
        attempt: 7,
        prompts: { create: { order: 1, targetPhrase: 'Hallo', translation: 'Hello' } },
      },
      include: { prompts: true },
    });
    const prompt = section.prompts[0]!;
    const recording = await instance.database.speakingRecording.create({
      data: {
        promptId: prompt.id,
        sectionId: section.id,
        userId: identity.ownerId,
        audioUrl: 'saved-audio',
        transcript: 'Hallo',
        feedback: 'Clear.',
      },
    });
    const capture = () =>
      instance.database.$transaction(
        async (database) => {
          await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
          return speakingRepairSourceHash(database, cls.id, 8);
        },
        { isolationLevel: 'Serializable' }
      );
    const original = await capture();
    expect(await capture()).toBe(original);
    await instance.database.speakingRecording.update({
      where: { id: recording.id },
      data: { feedback: 'Try again.' },
    });
    expect(await capture()).not.toBe(original);
    await instance.database.speakingRecording.update({
      where: { id: recording.id },
      data: { feedback: 'Clear.' },
    });
    const restored = await capture();
    await instance.database.speakingPrompt.update({
      where: { id: prompt.id },
      data: { referenceTtsUrl: 'new-reference' },
    });
    expect(await capture()).not.toBe(restored);
    const beforeReplacement = await capture();
    const savedRecording = await instance.database.speakingRecording.findUniqueOrThrow({
      where: { id: recording.id },
    });
    await instance.database.speakingRecording.delete({ where: { id: recording.id } });
    const replacement = await instance.database.speakingRecording.create({
      data: {
        id: savedRecording.id,
        incarnationId: savedRecording.incarnationId,
        promptId: savedRecording.promptId,
        sectionId: savedRecording.sectionId,
        userId: savedRecording.userId,
        audioUrl: savedRecording.audioUrl,
        transcript: savedRecording.transcript,
        feedback: savedRecording.feedback,
        createdAt: savedRecording.createdAt,
        updatedAt: savedRecording.updatedAt,
      },
    });
    expect(replacement.incarnationId).not.toBe(savedRecording.incarnationId);
    expect(await capture()).not.toBe(beforeReplacement);
    const other = await instance.database.user.create({
      data: { email: `${randomUUID()}@example.test` },
    });
    await instance.database.speakingRecording.update({
      where: { id: recording.id },
      data: { userId: other.id },
    });
    await expect(capture()).rejects.toThrow('Saved speaking work has inconsistent ownership.');
  });

  it('refuses a speaking snapshot when the recording fence is disabled', async () => {
    const { cls } = await repairTarget();
    await instance.database.$transaction(async (database) => {
      await database.$executeRaw`ALTER TABLE "SpeakingRecording" DISABLE TRIGGER "SpeakingRecording_formative_update"`;
      await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
      await expect(speakingRepairSourceHash(database, cls.id, 8)).rejects.toThrow(
        'The speaking database fence is unavailable.'
      );
      await database.$executeRaw`ALTER TABLE "SpeakingRecording" ENABLE TRIGGER "SpeakingRecording_formative_update"`;
    });
  });

  it.each([
    'unchanged',
    'saved recording',
    'reference',
    'envelope',
    'plaintext reference',
    'envelope after seal',
    'encrypted',
    'encrypted tampered before seal',
    'forged envelope',
    'missing attribution',
    'retired attribution',
    'concurrent retirement',
    'retained key',
    'key removed before activation',
    'cancelled stage',
    'cancelled redelivery',
    'cancelled orphaned reference',
    'staged recording',
    'staged score',
    'missing receipt',
  ] as const)(
    'publishes staged speaking only when its sealed evidence is intact (%s)',
    async (change) => {
      const { cls } = await repairTarget();
      await setSiteConfig(
        {
          ttsProvider: 'local',
          ttsBaseUrl: 'http://local-tts:8000',
          sttProvider: 'local',
          sttBaseUrl: 'http://local-stt:8000',
        },
        identity.ownerId
      );
      await instance.database.user.update({
        where: { id: identity.ownerId },
        data: { preferredTtsProvider: 'local' },
      });
      const requirements = createSkillRequirements({
        scope: 'CLASS',
        nativeLang: 'en',
        targetLang: 'de',
        level: 'A1',
        ttsProvider: 'local',
        sttProvider: 'local',
      });
      await instance.database.courseClass.update({
        where: { id: cls.id },
        data: { skillRequirements: requirements },
      });
      const old = await instance.database.classSection.create({
        data: {
          classId: cls.id,
          skill: 'SPEAKING',
          seed: 'old-speaking',
          spec: {},
          status: 'READY',
          attempt: 7,
          prompts: { create: { order: 1, targetPhrase: 'Hallo', translation: 'Hello' } },
        },
        include: { prompts: true },
      });
      const recording = await instance.database.speakingRecording.create({
        data: {
          promptId: old.prompts[0]!.id,
          sectionId: old.id,
          userId: identity.ownerId,
          audioUrl: 'saved-audio',
          transcript: 'Hallo',
          feedback: 'Clear.',
        },
      });
      const operation = await requestClassPreparation(courseId, execution, {
        intent: { kind: 'REPAIR', classId: cls.id, expectedAttempt: cls.attempt },
      });
      if (!operation.intent?.speakingSourceHash) throw new Error('Missing speaking source');
      const intent = operation.intent;
      if (change === 'missing receipt') {
        await classPreparationStore(instance.database, courseId).transact((current) => {
          if (!current?.intent) throw new Error('Missing operation');
          current.intent.skills = ['SPEAKING'];
          delete current.intent.retainedQuiz;
        });
        await processClassPreparation(await queuedJob(operation.id));
        expect((await classPreparationStore(instance.database, courseId).read())?.status).toBe(
          'FAILED'
        );
        expect(
          await instance.database.classSpeakingStage.findUnique({
            where: { operationId: operation.id },
          })
        ).toBeNull();
        expect(
          await instance.database.speakingRecording.findUnique({ where: { id: recording.id } })
        ).not.toBeNull();
        return;
      }
      await classPreparationStore(instance.database, courseId).transact((current) => {
        if (!current) throw new Error('Missing operation');
        current.status = 'RUNNING';
      });
      const staged = await sottoTransaction(instance.database, async (database) => {
        await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
        const section = await database.classSection.create({
          data: {
            classId: cls.id,
            skill: 'SPEAKING',
            seed: 'new-speaking',
            spec: {},
            status: 'READY',
            attempt: intent.attempt,
            withdrawn: true,
            prompts: { create: { order: 1, targetPhrase: 'Guten Tag', translation: 'Good day' } },
          },
          include: { prompts: true },
        });
        await stageClassSpeaking(database, operation, {
          classId: cls.id,
          attempt: intent.attempt,
          sectionId: section.id,
          sourceHash: intent.speakingSourceHash!,
        });
        return section;
      });
      const beforePublication = await instance.database.classSection.findMany({
        where: { classId: cls.id },
      });
      const binding = await sottoTransaction(instance.database, async (database) => {
        await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
        return verifySpeakingReferenceStage(database, operation, {
          sectionId: staged.id,
          promptId: staged.prompts[0]!.id,
        });
      });
      expect(binding).toEqual({
        instanceId: operation.instanceId,
        userId: operation.userId,
        userCreatedAt: operation.userCreatedAt,
        courseId: operation.courseId,
        courseCreatedAt: operation.courseCreatedAt,
        classId: cls.id,
        classCreatedAt: cls.createdAt.getTime(),
        sectionId: staged.id,
        sectionIncarnationId: staged.incarnationId,
        promptId: staged.prompts[0]!.id,
        promptIncarnationId: staged.prompts[0]!.incarnationId,
        attempt: intent.attempt,
        operationId: operation.id,
        sourceHash: intent.speakingSourceHash,
      });
      await expect(
        sottoTransaction(instance.database, async (database) => {
          await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
          return verifySpeakingReferenceStage(database, operation, {
            sectionId: staged.id,
            promptId: 'different-prompt',
          });
        })
      ).rejects.toThrow('The staged speaking reference changed.');
      expect(
        currentClassSections(beforePublication).find((section) => section.skill === 'SPEAKING')?.id
      ).toBe(old.id);
      if (change === 'cancelled orphaned reference') {
        expect(
          await instance.database.speakingPrompt.findUniqueOrThrow({
            where: { id: staged.prompts[0]!.id },
            select: { referenceTtsUrl: true, referenceEncryption: true },
          })
        ).toEqual({ referenceTtsUrl: null, referenceEncryption: null });
        await sottoTransaction(instance.database, async (database) => {
          const executor = {
            query: (sql: string, values: readonly unknown[]) =>
              database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          };
          const location = {
            kind: 'object' as const,
            endpoint: 'https://storage.example',
            bucket: 'private',
          };
          const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, {
            kind: 'object',
            location,
            binding: storageBackendBinding(location),
            publicUrl: 'https://storage.example',
          });
          await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
            backend
          );
          const reference = prepareStorageReference({
            namespace: SIDEDOOR_STATE_ID,
            operationId: randomUUID(),
            reference: 'https://storage.example/previous-audio',
            target: { backendId: backend.id, binding: backend.binding, key: 'previous-audio' },
            scopes: [{ subjectId: `course:${courseId}`, generation: operation.courseCreatedAt }],
          });
          await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
            consumers: [
              {
                consumer: `speaking-prompt:${staged.prompts[0]!.id}:reference`,
                previousReference: null,
              },
            ],
            next: reference,
          });
        });
      }
      if (
        change === 'cancelled stage' ||
        change === 'cancelled redelivery' ||
        change === 'cancelled orphaned reference'
      ) {
        await sottoTransaction(instance.database, async (database) => {
          await classPreparationStore(database, courseId).transact((current) => {
            if (!current) throw new Error('Missing operation');
            current.status = 'CANCELLING';
          });
          const record = await sottoJobOutbox(database).read(operation.id);
          if (!record) throw new Error('Missing operation receipt');
          await recordClassPreparationFailure(database, operation, record.fingerprint, false);
        });
        expect((await classPreparationStore(instance.database, courseId).read())?.status).toBe(
          'CANCELLED'
        );
        if (change === 'cancelled redelivery')
          await processClassPreparation(await queuedJob(operation.id));
        else await expect(requestClassPreparation(courseId, execution)).rejects.toThrow('cleanup');
        expect((await classPreparationStore(instance.database, courseId).read())?.status).toBe(
          'UNRESOLVED'
        );
        expect(
          await instance.database.classSpeakingStage.findUnique({ where: { sectionId: staged.id } })
        ).not.toBeNull();
        expect(
          (
            await sottoTransaction(instance.database, (database) =>
              sottoJobOutbox(database).read(operation.id)
            )
          )?.complete
        ).toBe(false);
        if (change === 'cancelled orphaned reference') {
          const preserved = await sottoTransaction(instance.database, async (database) => {
            const registry = new StorageReferenceRegistry(
              {
                query: (sql, values) =>
                  database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
              },
              'postgres',
              SIDEDOOR_STATE_ID
            );
            return registry.resolve({
              consumer: `speaking-prompt:${staged.prompts[0]!.id}:reference`,
              reference: 'https://storage.example/previous-audio',
            });
          });
          expect(preserved).not.toBeNull();
        }
        return;
      }
      if (change === 'envelope') {
        await expect(
          instance.database.speakingPrompt.update({
            where: { id: staged.prompts[0]!.id },
            data: { referenceEncryption: { version: 1 } },
          })
        ).rejects.toThrow();
        await instance.database.speakingPrompt.update({
          where: { id: staged.prompts[0]!.id },
          data: { referenceTtsUrl: 'opaque', referenceEncryption: { version: 1 } },
        });
        await expect(
          sottoTransaction(instance.database, async (database) => {
            await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
            await sealClassSpeaking(database, operation, {
              sectionId: staged.id,
              references: new Map([[staged.prompts[0]!.id, 'opaque']]),
            });
          })
        ).rejects.toThrow('The staged speaking references changed.');
        expect(
          (await instance.database.classSection.findUniqueOrThrow({ where: { id: staged.id } }))
            .withdrawn
        ).toBe(true);
        return;
      }
      if (change === 'plaintext reference') {
        await instance.database.speakingPrompt.update({
          where: { id: staged.prompts[0]!.id },
          data: { referenceTtsUrl: 'opaque' },
        });
        await expect(
          sottoTransaction(instance.database, async (database) => {
            await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
            await sealClassSpeaking(database, operation, {
              sectionId: staged.id,
              references: new Map([[staged.prompts[0]!.id, 'opaque']]),
            });
          })
        ).rejects.toThrow('The staged speaking references changed.');
        return;
      }
      const usesRetainedKey =
        change === 'retained key' || change === 'key removed before activation';
      const referenceKey = usesRetainedKey ? randomBytes(32) : speakingReferenceWrappingKey();
      if (usesRetainedKey)
        vi.stubEnv(
          'SOTTO_SPEAKING_REFERENCE_KEYRING',
          JSON.stringify({
            version: 1,
            active: 'legacy',
            keys: [referenceKey.toString('hex')],
          })
        );
      const encrypted =
        change === 'encrypted' ||
        change === 'encrypted tampered before seal' ||
        change === 'forged envelope' ||
        change === 'missing attribution' ||
        change === 'retired attribution' ||
        change === 'concurrent retirement' ||
        usesRetainedKey ||
        change === 'envelope after seal'
          ? encryptSpeakingReference(Buffer.from('reference audio'), binding, referenceKey)
          : null;
      referenceKey.fill(0);
      const forged =
        encrypted && change === 'forged envelope'
          ? { ...encrypted.envelope, wrapTag: Buffer.alloc(16).toString('base64') }
          : null;
      if (encrypted)
        await instance.database.speakingPrompt.update({
          where: { id: staged.prompts[0]!.id },
          data: {
            referenceTtsUrl: 'https://storage.example/encrypted-audio',
            referenceEncryption:
              forged ??
              (change === 'encrypted tampered before seal'
                ? { ...encrypted.envelope, byteLength: 9 }
                : encrypted.envelope),
          },
        });
      if (change === 'encrypted tampered before seal') {
        await expect(
          sottoTransaction(instance.database, async (database) => {
            await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
            await sealClassSpeaking(database, operation, {
              sectionId: staged.id,
              references: new Map([
                [staged.prompts[0]!.id, 'https://storage.example/encrypted-audio'],
              ]),
              encryptions: new Map([[staged.prompts[0]!.id, encrypted!.envelope]]),
            });
          })
        ).rejects.toThrow('The staged speaking references changed.');
        return;
      }
      if (forged) {
        await expect(
          sottoTransaction(instance.database, async (database) => {
            await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
            await sealClassSpeaking(database, operation, {
              sectionId: staged.id,
              references: new Map([
                [staged.prompts[0]!.id, 'https://storage.example/encrypted-audio'],
              ]),
              encryptions: new Map([[staged.prompts[0]!.id, forged]]),
            });
          })
        ).rejects.toThrow('The staged speaking references changed.');
        return;
      }
      const consumer = `speaking-prompt:${staged.prompts[0]!.id}:reference`;
      if (encrypted && change !== 'missing attribution') {
        await sottoTransaction(instance.database, async (database) => {
          const executor = {
            query: (sql: string, values: readonly unknown[]) =>
              database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          };
          const location = {
            kind: 'object' as const,
            endpoint: 'https://storage.example',
            bucket: 'private',
          };
          const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, {
            kind: 'object',
            location,
            binding: storageBackendBinding(location),
            publicUrl: 'https://storage.example',
          });
          await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
            backend
          );
          const prepared = prepareStorageReference({
            namespace: SIDEDOOR_STATE_ID,
            operationId: randomUUID(),
            reference: 'https://storage.example/encrypted-audio',
            target: { backendId: backend.id, binding: backend.binding, key: 'encrypted-audio' },
            scopes: [{ subjectId: `course:${courseId}`, generation: operation.courseCreatedAt }],
          });
          await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
            consumers: [{ consumer, previousReference: null }],
            next: prepared,
          });
        });
      }
      if (change === 'missing attribution') {
        await expect(
          sottoTransaction(instance.database, async (database) => {
            await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
            await sealClassSpeaking(database, operation, {
              sectionId: staged.id,
              references: new Map([
                [staged.prompts[0]!.id, 'https://storage.example/encrypted-audio'],
              ]),
              encryptions: new Map([[staged.prompts[0]!.id, encrypted!.envelope]]),
            });
          })
        ).rejects.toThrow('Storage input requires explicit imported attribution');
        return;
      }
      await sottoTransaction(instance.database, async (database) => {
        await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
        await sealClassSpeaking(database, operation, {
          sectionId: staged.id,
          references:
            change === 'encrypted' ||
            usesRetainedKey ||
            change === 'envelope after seal' ||
            change === 'retired attribution' ||
            change === 'concurrent retirement'
              ? new Map([[staged.prompts[0]!.id, 'https://storage.example/encrypted-audio']])
              : new Map(),
          ...(encrypted
            ? { encryptions: new Map([[staged.prompts[0]!.id, encrypted.envelope]]) }
            : {}),
        });
      });
      if (change === 'key removed before activation')
        vi.stubEnv('SOTTO_SPEAKING_REFERENCE_KEYRING', '');
      if (change === 'retired attribution')
        await sottoTransaction(instance.database, async (database) => {
          const executor = {
            query: (sql: string, values: readonly unknown[]) =>
              database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          };
          await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).retire({
            operationId: randomUUID(),
            consumer,
            previousReference: 'https://storage.example/encrypted-audio',
          });
        });
      if (change === 'saved recording')
        await instance.database.speakingRecording.update({
          where: { id: recording.id },
          data: { feedback: 'Updated.' },
        });
      if (change === 'reference')
        await instance.database.speakingPrompt.update({
          where: { id: staged.prompts[0]!.id },
          data: { referenceTtsUrl: 'unexpected-audio' },
        });
      if (change === 'envelope after seal')
        await instance.database.speakingPrompt.update({
          where: { id: staged.prompts[0]!.id },
          data: { referenceEncryption: { version: 2 } },
        });
      if (change === 'staged recording')
        await instance.database.speakingRecording.create({
          data: {
            promptId: staged.prompts[0]!.id,
            sectionId: staged.id,
            userId: identity.ownerId,
            audioUrl: 'unexpected-recording',
          },
        });
      if (change === 'staged score')
        await instance.database.classSection.update({
          where: { id: staged.id },
          data: { score: 1 },
        });
      const activate = () =>
        sottoTransaction(instance.database, async (database) => {
          await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
          await activateStagedSpeaking(database, operation);
        });
      if (change === 'concurrent retirement') {
        let signalLocked!: () => void;
        let release!: () => void;
        const locked = new Promise<void>((resolve) => {
          signalLocked = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const activation = sottoTransaction(instance.database, async (database) => {
          await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${cls.id} FOR UPDATE`;
          await activateStagedSpeaking(database, operation);
          signalLocked();
          await gate;
        });
        await Promise.race([
          locked,
          activation.then(() => {
            throw new Error('Activation finished before taking the fence');
          }),
        ]);
        try {
          await expect(
            instance.database.$transaction(async (database) => {
              await database.$executeRaw`SET LOCAL lock_timeout = '250ms'`;
              const executor = {
                query: (sql: string, values: readonly unknown[]) =>
                  database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
              };
              await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).retire({
                operationId: randomUUID(),
                consumer,
                previousReference: 'https://storage.example/encrypted-audio',
              });
            })
          ).rejects.toThrow(/lock timeout/);
        } finally {
          release();
          await activation;
        }
        expect(
          (await instance.database.classSection.findUniqueOrThrow({ where: { id: staged.id } }))
            .withdrawn
        ).toBe(false);
        return;
      }
      if (change === 'retired attribution')
        await expect(activate()).rejects.toThrow(
          'Storage reference does not belong to this consumer'
        );
      else if (change !== 'unchanged' && change !== 'encrypted' && change !== 'retained key')
        await expect(activate()).rejects.toThrow(
          /The staged speaking (material|references) changed/
        );
      else await expect(activate()).resolves.toBeUndefined();
      expect(
        (await instance.database.classSection.findUniqueOrThrow({ where: { id: staged.id } }))
          .withdrawn
      ).toBe(change !== 'unchanged' && change !== 'encrypted' && change !== 'retained key');
      expect(
        await instance.database.speakingRecording.findUnique({ where: { id: recording.id } })
      ).not.toBeNull();
    }
  );

  registerRetainedHistoryCases(() => ({ instance, identity, courseId, execution, repairTarget }));

  registerRepairConcurrencyCases(() => ({ instance, identity, courseId, execution, repairTarget }));

  registerRepairPublicationCases(() => ({
    instance,
    identity,
    courseId,
    execution,
    providerBoundary,
    repairTarget,
    queuedJob,
  }));

  registerRepairFinalizationCases(() => ({
    instance,
    identity,
    courseId,
    execution,
    repairTarget,
    providerBoundary,
    queuedJob,
  }));

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
});
