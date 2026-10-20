// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';
import { ensureLearningLevelBinding } from '@/lib/learning-map/binding';
import { publishLearningCatalog } from '@/lib/learning-map/catalog';
import { getLanguageCatalog } from '@/lib/learning-map/catalogs';
import { recordObjectiveObservation } from '@/lib/learning-map/evidence/record';
import { advanceLearningLevel } from '@/lib/learning-map/progression/advance';
import { readLearningMap } from '@/lib/learning-map/read';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('Versioned learning requirements against PostgreSQL', () => {
  let instance: SharedTestInstance;
  let userId: string;
  let course: Awaited<ReturnType<PrismaClient['course']['create']>>;
  let binding: Awaited<ReturnType<typeof ensureLearningLevelBinding>>;
  const catalog = getLanguageCatalog('de');
  beforeAll(async () => {
    instance = await createSharedTestInstance('learning_map');
    boundary.database = instance.database;
  });
  afterAll(async () => {
    await instance?.close();
    boundary.database = null;
  });
  beforeEach(async () => {
    userId = (await instance.reset()).ownerId;
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'German' },
      update: {},
    });
    course = await instance.database.course.create({
      data: {
        userId,
        curriculumId: curriculum.id,
        nativeLang: 'en',
        targetLang: 'de',
        currentLevel: 'A2',
        startLevel: 'A2',
      },
    });
    binding = await instance.database.$transaction((database) =>
      ensureLearningLevelBinding(
        database,
        course,
        'A2',
        createSkillRequirements({
          scope: 'CLASS',
          nativeLang: 'en',
          targetLang: 'de',
          level: 'A2',
          ttsProvider: null,
          sttProvider: null,
        })
      )
    );
  });
  function evidence() {
    const objective = catalog.nodes.find(
      (node) => node.kind === 'OBJECTIVE' && node.level === 'A2'
    );
    if (objective?.kind !== 'OBJECTIVE') throw new Error('Missing test objective');
    return {
      courseId: course.id,
      userId,
      bindingId: binding.id,
      objectiveId: objective.id,
      criterionVersion: objective.criterionVersion,
      skill: objective.skills[0]!,
      sourceType: 'PRACTICE_QUESTION' as const,
      sessionId: 'practice:one',
      taskId: 'question:one',
      responseIdentity: 'answer:one',
      quality: 1,
      evidence: {
        assessment: objective.assessment,
        rationale: 'The assessed response satisfies the criterion.',
      },
    };
  }
  const request = () => ({
    requestId: randomUUID(),
    expectedLevel: 'A2' as const,
    catalogHash: binding.revision.catalogHash,
  });
  const execution = () => ({ userId, authorize: async () => ({ userId }) });

  it('keeps placement and lower-level browsing separate from mastery', async () => {
    const map = await readLearningMap(instance.database, course);
    expect(map.readiness.ready).toBe(false);
    expect(
      map.nodes
        .filter((entry) => entry.node.kind === 'OBJECTIVE')
        .every((entry) => entry.progress?.status === 'NOT_ASSESSED')
    ).toBe(true);
    const lower = await readLearningMap(instance.database, course, 'A1');
    expect(lower.viewedLevel).toBe('A1');
    await expect(advanceLearningLevel(course.id, request(), execution())).rejects.toThrow(
      'remaining required objectives'
    );
    expect(
      (await instance.database.course.findUniqueOrThrow({ where: { id: course.id } })).currentLevel
    ).toBe('A2');
  });
  it('deduplicates replayed responses and rejects changed or foreign evidence', async () => {
    const input = evidence();
    const record = () =>
      instance.database.$transaction((database) => recordObjectiveObservation(database, input));
    const first = await record();
    const replay = await record();
    expect(replay.assessedTasks).toBe(1);
    expect(replay.mastery).toBe(first.mastery);
    expect(
      await instance.database.learningObservation.count({ where: { courseId: course.id } })
    ).toBe(1);
    await expect(
      instance.database.$transaction((database) =>
        recordObjectiveObservation(database, { ...input, quality: 0 })
      )
    ).rejects.toThrow('cannot be rewritten');
    await expect(
      instance.database.$transaction((database) =>
        recordObjectiveObservation(database, { ...input, userId: 'foreign' })
      )
    ).rejects.toThrow('owned');
    await expect(
      instance.database.$transaction((database) =>
        recordObjectiveObservation(database, { ...input, criterionVersion: 99 })
      )
    ).rejects.toThrow('does not match');
  });
  it('prevents criterion meaning from being resurrected after an intervening release', async () => {
    const objective = evidence().objectiveId;
    const revision2 = {
      ...catalog,
      version: 2,
      nodes: catalog.nodes.map((node) =>
        node.id === objective && node.kind === 'OBJECTIVE'
          ? { ...node, criterionVersion: 2, assessment: `${node.assessment} Explain the choice.` }
          : node
      ),
    };
    await instance.database.$transaction((database) => publishLearningCatalog(database, revision2));
    const revision3 = {
      ...revision2,
      version: 3,
      nodes: revision2.nodes.map((node) =>
        node.id === objective && node.kind === 'OBJECTIVE' ? { ...node, criterionVersion: 1 } : node
      ),
    };
    await expect(
      instance.database.$transaction((database) => publishLearningCatalog(database, revision3))
    ).rejects.toThrow('new criterion revision');
  });
  it('restores completed C2 maintenance without duplicating completion or accepting stale requirements', async () => {
    course = await instance.database.course.update({
      where: { id: course.id },
      data: { currentLevel: 'C2' },
    });
    const coverage = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'en',
      targetLang: 'de',
      level: 'C2',
      ttsProvider: null,
      sttProvider: null,
    });
    const finalBinding = await instance.database.$transaction((database) =>
      ensureLearningLevelBinding(database, course, 'C2', coverage)
    );
    const receipt = {
      completed: true,
      courseId: course.id,
      level: 'C2',
      currentLevel: 'C2',
      nextLevel: null,
      requirementId: finalBinding.id,
      completedAt: new Date().toISOString(),
      exemptSkills: ['LISTENING', 'SPEAKING'],
    };
    await instance.database.learningLevelCompletion.create({
      data: {
        requestId: randomUUID(),
        courseId: course.id,
        level: 'C2',
        bindingId: finalBinding.id,
        intentHash: 'original',
        evidenceHash: 'original',
        receipt,
      },
    });
    expect(
      await advanceLearningLevel(course.id, { ...request(), expectedLevel: 'C2' }, execution())
    ).toEqual(receipt);
    await expect(
      advanceLearningLevel(
        course.id,
        { ...request(), expectedLevel: 'C2', catalogHash: '0'.repeat(64) },
        execution()
      )
    ).rejects.toThrow('requirements changed');
    expect(
      await instance.database.learningLevelCompletion.count({ where: { courseId: course.id } })
    ).toBe(1);
  });
  it('advances exactly one band with a replayable receipt and preserves historical requirements', async () => {
    await instance.database.$transaction(
      async (database) => {
        for (const objective of catalog.nodes) {
          if (objective.kind !== 'OBJECTIVE' || objective.level !== 'A2') continue;
          for (const skill of objective.skills) {
            if (skill === 'LISTENING' || skill === 'SPEAKING') continue;
            for (let task = 0; task < 5; task++)
              await recordObjectiveObservation(database, {
                ...evidence(),
                objectiveId: objective.id,
                criterionVersion: objective.criterionVersion,
                skill,
                sessionId: `practice:${task < 3 ? 'one' : 'two'}`,
                taskId: `${objective.id}:${skill}:${task}`,
                responseIdentity: `response:${task}`,
                evidence: {
                  assessment: objective.assessment,
                  rationale: 'The assessed response satisfies the criterion.',
                },
              });
          }
        }
      },
      { timeout: 30000 }
    );
    const input = request();
    const receipt = await advanceLearningLevel(course.id, input, execution());
    expect(receipt).toMatchObject({
      level: 'A2',
      currentLevel: 'B1',
      nextLevel: 'B1',
      exemptSkills: ['LISTENING', 'SPEAKING'],
    });
    expect(await advanceLearningLevel(course.id, input, execution())).toEqual(receipt);
    expect(
      await instance.database.learningLevelBinding.findUnique({
        where: { courseId_level: { courseId: course.id, level: 'B1' } },
      })
    ).not.toBeNull();
    await instance.database.course.delete({ where: { id: course.id } });
    expect(
      await instance.database.learningObservation.count({ where: { courseId: course.id } })
    ).toBe(0);
    expect(
      await instance.database.learningLevelCompletion.count({ where: { courseId: course.id } })
    ).toBe(0);
  });
});
