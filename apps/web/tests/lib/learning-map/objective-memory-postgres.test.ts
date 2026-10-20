// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSkillRequirements,
  memoryGraphResponseSchema,
  type LearningObjective,
} from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import { getDueItems, getMemoryGraph } from '@/lib/knowledge-graph';
import { ensureLearningLevelBinding, readBoundCatalog } from '@/lib/learning-map/binding';
import { publishLearningCatalog } from '@/lib/learning-map/catalog';
import { getLanguageCatalog } from '@/lib/learning-map/catalogs';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('qualified objective memory reads against PostgreSQL', () => {
  let instance: SharedTestInstance;
  let courseId: string;
  const now = new Date();
  const past = new Date(now.getTime() - 86400000);
  const coverage = createSkillRequirements({
    scope: 'CLASS',
    nativeLang: 'en',
    targetLang: 'de',
    level: 'A2',
    ttsProvider: null,
    sttProvider: null,
  });
  beforeAll(async () => {
    instance = await createSharedTestInstance('objective_memory');
    boundary.database = instance.database;
  });
  afterAll(async () => {
    await instance?.close();
    boundary.database = null;
  });
  beforeEach(async () => {
    const identity = await instance.reset();
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Owned memory fixture' },
      update: {},
    });
    courseId = (
      await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          curriculumId: curriculum.id,
          nativeLang: 'en',
          targetLang: 'de',
          currentLevel: 'A2',
        },
      })
    ).id;
  });
  async function pin() {
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    const binding = await instance.database.$transaction((database) =>
      ensureLearningLevelBinding(database, course, 'A2', coverage)
    );
    const objective = readBoundCatalog(binding).catalog.nodes.find(
      (node): node is LearningObjective =>
        node.kind === 'OBJECTIVE' &&
        node.level === 'A2' &&
        node.branch === 'GRAMMAR' &&
        node.grammarKeys.length > 0
    );
    if (!objective) throw new Error('Expected a precise A2 grammar alias.');
    return { binding, objective };
  }
  async function evidence(
    objective: LearningObjective,
    criterionVersion = objective.criterionVersion
  ) {
    await instance.database.learnerObjectiveState.createMany({
      data: objective.skills.map((skill) => ({
        courseId,
        objectiveId: objective.id,
        criterionVersion,
        policyVersion: objective.policyVersion,
        level: objective.level,
        skill,
        mastery: 0.94,
        assessedTasks: 6,
        assessedSessions: 2,
        lastQuality: 1,
        lastReviewed: past,
        dueAt: past,
      })),
    });
  }
  it('reads qualified due objectives separately and excludes only precise aliases from legacy due grammar', async () => {
    const { objective, binding } = await pin();
    await evidence(objective);
    await instance.database.learnerGrammar.createMany({
      data: [
        {
          courseId,
          topicKey: objective.grammarKeys[0]!,
          title: objective.title,
          cefrLevel: 'A2',
          mastery: 0.1,
          dueAt: past,
        },
        {
          courseId,
          topicKey: 'plusquamperfekt',
          title: 'Unresolved broad legacy topic',
          cefrLevel: 'A2',
          mastery: 0.2,
          dueAt: past,
        },
      ],
    });
    await instance.database.learnerVocab.create({
      data: {
        courseId,
        lemma: 'Owned word',
        translation: 'Owned gloss',
        mastery: 0.1,
        dueAt: past,
      },
    });
    const before = await instance.database.learnerObjectiveState.findMany({ where: { courseId } });
    const revisions = await instance.database.learningMapRevision.count();
    const due = await getDueItems(courseId);
    expect(due.vocab.map((item) => item.lemma)).toEqual(['Owned word']);
    expect(due.grammar.map((item) => item.topicKey)).toEqual(['plusquamperfekt']);
    expect(due.objectives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirementId: binding.id,
          objective: expect.objectContaining({ id: objective.id }),
          progress: expect.objectContaining({ status: 'CONFIDENT', reviewDue: true }),
        }),
      ])
    );
    const graph = memoryGraphResponseSchema.parse(await getMemoryGraph(courseId));
    expect(
      graph.objectives.find((entry) => entry.objective.id === objective.id)?.progress
    ).toMatchObject({ status: 'CONFIDENT', reviewDue: true });
    expect(
      graph.nodes.find((node) => node.kind === 'grammar' && node.label === objective.title)
        ?.strength
    ).toBe(0.1);
    expect(await instance.database.learnerObjectiveState.findMany({ where: { courseId } })).toEqual(
      before
    );
    expect(await instance.database.learningMapRevision.count()).toBe(revisions);
    expect(await instance.database.learningObservation.count()).toBe(0);
  });

  it('does not turn stale criterion projections or high legacy grammar strength into qualified memory', async () => {
    const { objective } = await pin();
    await evidence(objective, objective.criterionVersion + 1);
    await instance.database.learnerGrammar.create({
      data: {
        courseId,
        topicKey: objective.grammarKeys[0]!,
        title: objective.title,
        cefrLevel: 'A2',
        mastery: 1,
        dueAt: past,
      },
    });
    const graph = await getMemoryGraph(courseId);
    const progress = graph.objectives.find(
      (entry) => entry.objective.id === objective.id
    )?.progress;
    expect(progress).toMatchObject({ status: 'NOT_ASSESSED', reviewDue: false });
    expect(progress?.skills.every((skill) => skill.evidence === null)).toBe(true);
    expect((await getDueItems(courseId)).objectives).toEqual([]);
  });
  it('filters qualified reviews to the requested band and skill before applying the limit without writing evidence', async () => {
    const { objective } = await pin();
    await evidence(objective);
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    const lowerCoverage = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'en',
      targetLang: 'de',
      level: 'A1',
      ttsProvider: null,
      sttProvider: null,
    });
    const lowerBinding = await instance.database.$transaction((database) =>
      ensureLearningLevelBinding(database, course, 'A1', lowerCoverage)
    );
    const lower = readBoundCatalog(lowerBinding).catalog.nodes.find(
      (node): node is LearningObjective =>
        node.kind === 'OBJECTIVE' && node.level === 'A1' && node.branch === 'GRAMMAR'
    );
    if (!lower) throw new Error('Expected lower-band objective.');
    await evidence(lower);
    const before = await instance.database.learnerObjectiveState.findMany({ where: { courseId } });
    const due = await getDueItems(courseId, 1, { level: 'A2', targetLang: 'de', kind: 'GRAMMAR' });
    expect(due.objectives.map((entry) => entry.objective.id)).toEqual([objective.id]);
    expect(
      (await getDueItems(courseId, 1, { level: 'A2', targetLang: 'de', kind: 'READING' }))
        .objectives
    ).toEqual([]);
    expect(await instance.database.learnerObjectiveState.findMany({ where: { courseId } })).toEqual(
      before
    );
    expect(await instance.database.learningObservation.count()).toBe(0);
  });

  it('preserves ambiguous aliases and does not publish a catalog while reading an unbound course', async () => {
    const unbound = await getMemoryGraph(courseId);
    expect(unbound.objectives).toEqual([]);
    const catalog = structuredClone(getLanguageCatalog('de'));
    catalog.version += 1;
    const candidates = catalog.nodes.filter(
      (node): node is LearningObjective =>
        node.kind === 'OBJECTIVE' && node.level === 'A2' && node.branch === 'GRAMMAR'
    );
    const first = candidates[0]!,
      second = candidates[1]!;
    const alias = first.grammarKeys[0]!;
    second.grammarKeys.push(alias);
    const revision = await instance.database.$transaction((database) =>
      publishLearningCatalog(database, catalog)
    );
    await instance.database.learningLevelBinding.create({
      data: { courseId, level: 'A2', revisionId: revision.id, policyVersion: 1, coverage },
    });
    await instance.database.learnerGrammar.create({
      data: {
        courseId,
        topicKey: alias,
        title: 'Ambiguous fixture topic',
        cefrLevel: 'A2',
        mastery: 0.1,
        dueAt: past,
      },
    });
    expect((await getDueItems(courseId)).grammar.map((item) => item.topicKey)).toEqual([alias]);
    expect(await instance.database.learningLevelBinding.count({ where: { courseId } })).toBe(1);
    expect(await instance.database.learningObservation.count()).toBe(0);
  });
});
