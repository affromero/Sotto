// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSkillRequirements,
  learningSelectionPreviewSchema,
  type LearningObjective,
} from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import { POST as preview } from '@/app/api/v1/courses/[courseId]/learning-map/selection/route';
import { createInitialCourse } from '@/lib/placement-course';
import { ensureLearningLevelBinding } from '@/lib/learning-map/binding';
import { getLanguageCatalog } from '@/lib/learning-map/catalogs';
import { readLearningMap } from '@/lib/learning-map/read';
import { captureObjectiveAssessmentScope } from '@/lib/learning-map/evidence/scope';
import { recordObjectiveObservation } from '@/lib/learning-map/evidence/record';
import { capturePracticeContext } from '@/lib/practice/context';
import {
  requestPracticePreparation,
  readPracticePreparation,
  validatePracticePreparation,
  writePracticePreparation,
  validatePracticeSpeechConfiguration,
} from '@/lib/practice/preparation';
import { learningSpeechFingerprint } from '@/lib/learning/speech-configuration';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
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
suite('optional oral assessments after a completed exempt band', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let course: Awaited<ReturnType<typeof createInitialCourse>>;
  const catalog = getLanguageCatalog('de');
  const objective = catalog.nodes.find(
    (node): node is LearningObjective =>
      node.kind === 'OBJECTIVE' && node.level === 'A2' && node.branch === 'SITUATIONS'
  )!;
  const selection = {
    catalogVersion: catalog.version,
    nodeIds: [objective.id],
    level: 'A2' as const,
  };
  const execution = () => ({
    userId: identity.ownerId,
    authorize: async () => ({ userId: identity.ownerId }),
  });
  beforeAll(async () => {
    instance = await createSharedTestInstance('optional_oral');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    identity = await instance.reset();
    await instance.seedAiCredential(identity.ownerId, 'openai', 'synthetic-optional-oral-key');
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: {
        preferredAiProvider: 'openai',
        preferredAiModel: getAiProviderMeta('openai').defaultModel,
      },
    });
    await instance.configureInfrastructure({ sttProvider: 'together' });
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Optional oral fixture' },
      update: {},
    });
    course = await sottoTransaction(instance.database, (tx) =>
      createInitialCourse(
        tx,
        {
          userId: identity.ownerId,
          native: 'en',
          target: 'de',
          curriculumId: curriculum.id,
          level: 'A2',
          source: 'MANUAL',
        },
        execution()
      )
    );
    vi.stubGlobal('fetch', async () => {
      throw new Error('No provider dispatch is allowed in this fixture.');
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });
  async function formats() {
    const response = await preview(
      new NextRequest(`http://localhost:3000/api/v1/courses/${course.id}/learning-map/selection`, {
        method: 'POST',
        headers: {
          cookie: `sotto_session=${identity.ownerToken}`,
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify(selection),
      }),
      { params: Promise.resolve({ courseId: course.id }) }
    );
    expect(response.status).toBe(200);
    return learningSelectionPreviewSchema.parse(await response.json());
  }
  const enable = () =>
    instance.configureInfrastructure({
      ttsProvider: 'local',
      ttsBaseUrl: 'http://127.0.0.1:9',
      sttProvider: 'local',
      sttBaseUrl: 'http://127.0.0.1:9',
    });
  it('offers newly configured oral formats and retains optional evidence without changing gate coverage or an earned receipt', async () => {
    expect((await formats()).availableKinds).not.toContain('SPEAKING');
    const binding = await instance.database.learningLevelBinding.findUniqueOrThrow({
      where: { courseId_level: { courseId: course.id, level: 'A2' } },
    });
    const oldBinding = await sottoTransaction(instance.database, (tx) =>
      ensureLearningLevelBinding(
        tx,
        course,
        'A1',
        createSkillRequirements({
          scope: 'CLASS',
          nativeLang: 'en',
          targetLang: 'de',
          level: 'A1',
          ttsProvider: null,
          sttProvider: null,
        })
      )
    );
    const receipt = {
      completed: true,
      courseId: course.id,
      level: 'A1',
      currentLevel: 'A2',
      nextLevel: 'A2',
      requirementId: oldBinding.id,
      completedAt: '2026-10-20T12:00:00.000Z',
      exemptSkills: ['LISTENING', 'SPEAKING'],
    };
    await instance.database.learningLevelCompletion.create({
      data: {
        requestId: randomUUID(),
        courseId: course.id,
        level: 'A1',
        nextLevel: 'A2',
        bindingId: oldBinding.id,
        intentHash: 'earned-fixture',
        evidenceHash: 'earned-fixture',
        receipt,
      },
    });
    const before = await sottoTransaction(instance.database, (tx) => readLearningMap(tx, course));
    await enable();
    expect((await formats()).availableKinds).toEqual(
      expect.arrayContaining(['LISTENING', 'SPEAKING'])
    );
    const context = await capturePracticeContext(
      course.id,
      identity.ownerId,
      'SPEAKING',
      execution(),
      { learningSelection: selection }
    );
    expect(context.requirements.skills.SPEAKING.state).toBe('REQUIRED');
    expect(context.levelCoverage?.skills.SPEAKING.state).toBe('EXEMPT_NO_PROVIDER');
    const scope = await sottoTransaction(instance.database, (tx) =>
      captureObjectiveAssessmentScope(tx, {
        courseId: course.id,
        userId: identity.ownerId,
        execution: execution(),
        requirements: context.requirements,
        level: 'A2',
        selection: context.learningSelection,
      })
    );
    const criterion = scope?.criteria.find((value) => value.skill === 'SPEAKING');
    expect(criterion).toBeDefined();
    for (let i = 0; i < 5; i++)
      await sottoTransaction(instance.database, (tx) =>
        recordObjectiveObservation(tx, {
          courseId: course.id,
          userId: identity.ownerId,
          bindingId: binding.id,
          objectiveId: objective.id,
          criterionVersion: objective.criterionVersion,
          skill: 'SPEAKING',
          sourceType: 'SPEAKING_CRITERION',
          sessionId: `optional:${i < 3 ? 1 : 2}`,
          taskId: `independent-task:${i}`,
          responseIdentity: `recorded-response:${i}`,
          quality: 1,
          evidence: {
            assessment: criterion!.assessment,
            rationale:
              'The independently assessed recorded response meets this exact speaking criterion.',
          },
        })
      );
    const after = await sottoTransaction(instance.database, (tx) => readLearningMap(tx, course));
    expect(after.readiness).toEqual(before.readiness);
    expect(
      after.nodes
        .find((value) => value.node.id === objective.id)
        ?.progress?.skills.find((value) => value.skill === 'SPEAKING')
    ).toMatchObject({
      exempt: true,
      status: 'CONFIDENT',
      evidence: { assessedTasks: 5, assessedSessions: 2 },
    });
    expect(
      (
        await instance.database.learningLevelBinding.findUniqueOrThrow({
          where: { id: binding.id },
        })
      ).coverage
    ).toEqual(binding.coverage);
    expect((await instance.database.learningLevelCompletion.findFirstOrThrow()).receipt).toEqual(
      receipt
    );
    expect(
      (await instance.database.course.findUniqueOrThrow({ where: { id: course.id } })).currentLevel
    ).toBe('A2');
  });
  it('keeps an admitted all-exempt attempt unchanged when unrelated new provider settings are invalid', async () => {
    const admitted = await requestPracticePreparation(course.id, 'FULL', execution(), {
      requestId: randomUUID(),
      learningSelection: selection,
    });
    const original = await sottoTransaction(instance.database, (tx) =>
      readPracticePreparation(tx, admitted.sessionId)
    );
    await sottoTransaction(instance.database, (tx) =>
      writePracticePreparation(tx, { ...original.operation, status: 'RUNNING' })
    );
    await instance.configureInfrastructure({
      ttsProvider: 'local',
      ttsBaseUrl: 'file:///invalid-new-tts',
      sttProvider: 'local',
      sttBaseUrl: 'file:///invalid-new-stt',
    });
    const checked = await sottoTransaction(instance.database, (tx) =>
      validatePracticePreparation(tx, admitted.sessionId, original.operation.id)
    );
    expect(checked.generation.requirements).toEqual(original.generation.requirements);
    expect(checked.generation.requirements.skills.SPEAKING.state).toBe('EXEMPT_NO_PROVIDER');
    expect(checked.operation.inputFingerprint).toBe(original.operation.inputFingerprint);
  });
  it('ignores newly configured unrequested reference TTS but rejects changes to a captured required STT provider', async () => {
    await instance.configureInfrastructure({
      sttProvider: 'local',
      sttBaseUrl: 'http://127.0.0.1:9',
    });
    const admitted = await requestPracticePreparation(course.id, 'SPEAKING', execution(), {
      requestId: randomUUID(),
      learningSelection: selection,
    });
    const original = await sottoTransaction(instance.database, (tx) =>
      readPracticePreparation(tx, admitted.sessionId)
    );
    await instance.configureInfrastructure({
      ttsProvider: 'local',
      ttsBaseUrl: 'file:///invalid-new-tts',
      sttProvider: 'local',
      sttBaseUrl: 'http://127.0.0.1:9',
    });
    const fingerprint = await sottoTransaction(instance.database, (tx) =>
      learningSpeechFingerprint(tx, execution().authorize, original.generation.requirements)
    );
    expect(fingerprint).toBe(original.operation.speechFingerprint);
    await instance.configureInfrastructure({ sttProvider: 'openai' });
    await expect(
      sottoTransaction(instance.database, (tx) => validatePracticeSpeechConfiguration(tx, original))
    ).rejects.toThrow();
  });
  it('accepts only the two historical empty fingerprints for an immutable no-audio attempt', async () => {
    const admitted = await requestPracticePreparation(course.id, 'FULL', execution(), {
      requestId: randomUUID(),
      learningSelection: selection,
    });
    const original = await sottoTransaction(instance.database, (tx) =>
      readPracticePreparation(tx, admitted.sessionId)
    );
    await enable();
    for (const marker of ['{}', '{"audioDisabled":true}']) {
      const work = {
        ...original,
        operation: {
          ...original.operation,
          speechFingerprint: createHash('sha256').update(marker).digest('hex'),
        },
      };
      await expect(
        sottoTransaction(instance.database, (tx) => validatePracticeSpeechConfiguration(tx, work))
      ).resolves.toBeUndefined();
    }
    const invalid = {
      ...original,
      operation: {
        ...original.operation,
        speechFingerprint: createHash('sha256').update('{"unknown":true}').digest('hex'),
      },
    };
    await expect(
      sottoTransaction(instance.database, (tx) => validatePracticeSpeechConfiguration(tx, invalid))
    ).rejects.toThrow(/speech model, endpoint or credential changed/);
    const required = {
      ...original,
      generation: {
        ...original.generation,
        requirements: createSkillRequirements({
          scope: 'FULL',
          nativeLang: 'en',
          targetLang: 'de',
          level: 'A2',
          ttsProvider: 'local',
          sttProvider: 'local',
        }),
      },
    };
    await expect(
      sottoTransaction(instance.database, (tx) => validatePracticeSpeechConfiguration(tx, required))
    ).rejects.toThrow(/speech model, endpoint or credential changed/);
  });
});
