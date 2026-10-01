// @vitest-environment node
import { createSkillRequirements } from '@sotto/shared';
import { classRepairSkills, selectClassRepairSkills } from '@/lib/learning/classes/class-repair';
import { setSiteConfig } from '@/lib/site-config';
import { randomUUID, createHash } from 'node:crypto';
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
  cancelClassPreparation,
  classPreparationStore,
  validateClassPreparation,
} from '@/lib/classes/preparation';

import { processClassPreparation } from '@/workers/classes/class-preparation.worker';

import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
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

  it('does not waive a frozen listening requirement when its provider is removed', async () => {
    await setSiteConfig(
      { ttsProvider: 'local', ttsBaseUrl: 'http://localhost:9001', sttProvider: null },
      identity.ownerId
    );
    const admitted = await running();
    expect(admitted.requirements?.skills.LISTENING.state).toBe('REQUIRED');
    await setSiteConfig({ ttsProvider: null }, identity.ownerId);
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

  async function repairTarget() {
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    const lesson = await instance.database.lesson.create({
      data: {
        curriculumId: course.curriculumId,
        slug: randomUUID(),
        level: 'A1',
        order:
          (await instance.database.lesson.count({ where: { curriculumId: course.curriculumId } })) +
          1,
        title: 'Greetings',
        objective: 'Greet someone',
        grammarPoints: [],
        targetVocab: [],
        vocabThemes: [],
      },
    });
    const requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'en',
      targetLang: 'de',
      level: 'A1',
      ttsProvider: null,
      sttProvider: null,
    });
    const cls = await instance.database.courseClass.create({
      data: {
        courseId,
        lessonId: lesson.id,
        order: 1,
        status: 'IN_PROGRESS',
        skillRequirements: requirements,
        learnerAnswers: { 'historical-answer': 1 },
        writingDrafts: { 'historical-draft': 'Keep my words.' },
      },
    });
    await instance.database.course.update({
      where: { id: courseId },
      data: { activeClassId: cls.id },
    });
    const grammar = await instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill: 'GRAMMAR',
        seed: 'original',
        spec: {},
        status: 'READY',
        attempt: 7,
        questions: {
          create: Array.from({ length: 5 }, (_, order) => ({
            order: order + 1,
            skill: 'GRAMMAR' as const,
            question: `Greeting ${order}?`,
            options: ['Hallo', 'Tschüss', 'Morgen', 'Gestern'],
            correctIndex: 0,
            explanation: 'Hallo greets someone.',
          })),
        },
      },
      include: { questions: true },
    });
    const writing = await instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill: 'WRITING',
        seed: 'earlier',
        spec: {},
        status: 'READY',
        attempt: 2,
        writingPrompts: {
          create: {
            order: 1,
            task: 'Write a greeting.',
            responses: {
              create: {
                userId: identity.ownerId,
                attempt: 2,
                text: 'Hallo.',
                overallScore: 0.9,
                corrections: [],
                feedback: 'Clear greeting.',
              },
            },
          },
        },
      },
      include: { writingPrompts: true },
    });
    return { cls, grammar, writing, requirements };
  }

  it('atomically claims repair from complete history and replays the same durable admission', async () => {
    const { cls, grammar, writing, requirements } = await repairTarget();
    const input = {
      intent: { kind: 'REPAIR' as const, classId: cls.id, expectedAttempt: cls.attempt },
    };
    const admitted = await requestClassPreparation(courseId, execution, input);
    const replay = await requestClassPreparation(courseId, execution, input);
    expect(replay.id).toBe(admitted.id);
    expect(admitted.intent).toMatchObject({
      classId: cls.id,
      kind: 'REPAIR',
      attempt: 8,
      skills: ['READING', 'WRITING'],
    });
    const saved = await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } });
    expect(saved).toMatchObject({
      status: 'GENERATING',
      attempt: 8,
      skillRequirements: requirements,
      learnerAnswers: cls.learnerAnswers,
      writingDrafts: cls.writingDrafts,
    });
    expect(await instance.database.classSection.count({ where: { classId: cls.id } })).toBe(2);
    expect(await instance.database.lessonQuestion.count({ where: { sectionId: grammar.id } })).toBe(
      5
    );
    expect(
      await instance.database.writingResponse.findFirst({
        where: { promptId: writing.writingPrompts[0].id },
      })
    ).toMatchObject({ text: 'Hallo.', overallScore: 0.9 });
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(admitted.id)
      )
    ).not.toBeNull();
  });

  it('replays a completed repair after its acknowledgement was lost without claiming new paid work', async () => {
    const { cls } = await repairTarget();
    const input = {
      intent: { kind: 'REPAIR' as const, classId: cls.id, expectedAttempt: cls.attempt },
    };
    const admitted = await requestClassPreparation(courseId, execution, input);
    await classPreparationStore(instance.database, courseId).transact((current) => {
      if (!current) throw new Error('Missing operation');
      current.status = 'COMPLETED';
      current.result = 'created';
    });
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { status: 'AVAILABLE' },
    });
    const replay = await requestClassPreparation(courseId, execution, input);
    expect(replay.id).toBe(admitted.id);
    expect(replay.status).toBe('COMPLETED');
    expect(
      (await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })).attempt
    ).toBe(8);
  });

  it('runs an extraction-memory-only repair without replacing answered material or calling a provider', async () => {
    const { cls, writing } = await repairTarget();
    await instance.database.writingPrompt.createMany({
      data: [2, 3].map((order) => ({
        sectionId: writing.id,
        order,
        task: 'Reply to a greeting.',
      })),
    });
    const passageText = 'Mia sagt Hallo.';
    await instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill: 'READING',
        seed: 'saved-reading',
        status: 'READY',
        spec: {},
        questions: {
          create: Array.from({ length: 5 }, (_, order) => ({
            skill: 'READING' as const,
            order: order + 1,
            passageText,
            question: 'What does Mia say?',
            options: ['Hallo', 'Tschüss', 'Morgen', 'Gestern'],
            correctIndex: 0,
            explanation: 'Mia says Hallo.',
          })),
        },
      },
    });
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: {
        adaptiveSeed: {
          intro: {
            purpose: 'Greet someone.',
            about: 'Greetings.',
            focus: ['Greeting'],
            examples: [],
            tips: [],
          },
        },
        readingVocabulary: {
          passageText,
          sourceHash: createHash('sha256').update(passageText).digest('hex'),
          words: [
            {
              lemma: 'Hallo',
              gloss: 'hello',
              pos: 'expression',
              sourceForm: 'Hallo',
              questionIds: [],
            },
          ],
        },
      },
    });
    vi.stubGlobal('fetch', async () => {
      throw new Error('Preserved material must not ask a provider again.');
    });
    const admitted = await requestClassPreparation(courseId, execution, {
      intent: { kind: 'REPAIR', classId: cls.id, expectedAttempt: cls.attempt },
    });
    expect(admitted.intent?.skills).toEqual([]);
    await processClassPreparation(await queuedJob(admitted.id));
    await processClassPreparation(await queuedJob(admitted.id));
    expect((await classPreparationStore(instance.database, courseId).read())?.status).toBe(
      'COMPLETED'
    );
    expect(
      await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
    ).toMatchObject({
      status: 'IN_PROGRESS',
      attempt: 8,
      learnerAnswers: cls.learnerAnswers,
      writingDrafts: cls.writingDrafts,
    });
    expect(await instance.database.classSection.count({ where: { classId: cls.id } })).toBe(3);
    expect(
      await instance.database.learnerVocab.findFirst({ where: { courseId, lemma: 'Hallo' } })
    ).toMatchObject({ translation: 'hello', reps: 0 });
  });

  it('settles a cancelled queued repair without deleting learner history or the active gate', async () => {
    const { cls, grammar } = await repairTarget();
    await requestClassPreparation(courseId, execution, {
      intent: { kind: 'REPAIR', classId: cls.id, expectedAttempt: cls.attempt },
    });
    const cancelled = await cancelClassPreparation(courseId, execution);
    expect(cancelled?.status).toBe('CANCELLED');
    expect(
      await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
    ).toMatchObject({
      status: 'FAILED',
      attempt: 8,
      learnerAnswers: cls.learnerAnswers,
      writingDrafts: cls.writingDrafts,
    });
    expect(
      await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })
    ).toMatchObject({ activeClassId: cls.id });
    expect(await instance.database.lessonQuestion.count({ where: { sectionId: grammar.id } })).toBe(
      5
    );
  });

  it('rejects a competing repair intent without leaving another claimed attempt', async () => {
    const { cls } = await repairTarget();
    const first = await requestClassPreparation(courseId, execution, {
      intent: { kind: 'REPAIR', classId: cls.id, expectedAttempt: cls.attempt },
    });
    await expect(
      requestClassPreparation(courseId, execution, {
        intent: { kind: 'REGENERATE', classId: cls.id, expectedAttempt: cls.attempt },
      })
    ).rejects.toThrow(/active preparation/);
    expect(
      await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
    ).toMatchObject({ attempt: 8 });
    expect((await classPreparationStore(instance.database, courseId).read())?.id).toBe(first.id);
  });

  it('keeps an unsubmitted complete section while repairing partial and missing skills', async () => {
    const { cls, requirements } = await repairTarget();
    const material = await instance.database.courseClass.findUniqueOrThrow({
      where: { id: cls.id },
      include: {
        course: true,
        lesson: true,
        sections: {
          include: {
            questions: true,
            prompts: true,
            writingPrompts: true,
            episode: { include: { script: true } },
          },
        },
      },
    });
    expect(classRepairSkills(material, requirements)).toEqual(['READING', 'WRITING']);
    const grammar = material.sections.find((section) => section.skill === 'GRAMMAR')!;
    await instance.database.classSection.update({
      where: { id: grammar.id },
      data: { passed: false },
    });
    grammar.passed = false;
    expect(classRepairSkills(material, requirements)).toEqual(['GRAMMAR', 'READING', 'WRITING']);
  });

  it('repairs speaking when populated reference URLs lack owned storage attribution', async () => {
    const { cls } = await repairTarget();
    const requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'en',
      targetLang: 'de',
      level: 'A1',
      ttsProvider: 'local',
      sttProvider: 'local',
    });
    await instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill: 'SPEAKING',
        status: 'READY',
        seed: 'saved',
        spec: {},
        prompts: {
          create: Array.from({ length: 4 }, (_, index) => ({
            order: index + 1,
            targetPhrase: 'Hallo Mia.',
            translation: 'Hello Mia.',
            referenceTtsUrl: `/foreign/${index}.mp3`,
          })),
        },
      },
    });
    const material = await instance.database.courseClass.findUniqueOrThrow({
      where: { id: cls.id },
      include: {
        course: true,
        lesson: true,
        sections: {
          include: {
            questions: true,
            prompts: true,
            writingPrompts: true,
            episode: { include: { script: true } },
          },
        },
      },
    });
    expect(classRepairSkills(material, requirements)).not.toContain('SPEAKING');
    expect(
      await instance.database.$transaction((database) =>
        selectClassRepairSkills(database, material, requirements)
      )
    ).toContain('SPEAKING');
  });

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
