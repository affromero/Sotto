import {
  evaluateLevelReadiness,
  objectiveProgress,
  type CefrLevel,
  type ObjectiveEvidenceState,
  type LearningNode,
  type ObjectiveProgress,
} from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { classPreparationStore } from '../classes/preparation';
import { readCourseCatalog } from './catalog';
import { learningCoverageExemptions, type LearningCourse } from './binding';

export class LearningMapError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 422
  ) {
    super(message);
  }
}

export const learningCourseSelect = {
  id: true,
  userId: true,
  nativeLang: true,
  targetLang: true,
  currentLevel: true,
} as const;

export async function ownedLearningCourse(
  database: Prisma.TransactionClient,
  courseId: string,
  userId: string
): Promise<LearningCourse> {
  const course = await database.course.findFirst({
    where: { id: courseId, userId },
    select: learningCourseSelect,
  });
  if (!course) throw new LearningMapError('Course not found.', 404);
  return course;
}

export async function readObjectiveStates(
  database: Prisma.TransactionClient,
  courseId: string,
  level: CefrLevel
): Promise<ObjectiveEvidenceState[]> {
  const rows = await database.learnerObjectiveState.findMany({ where: { courseId, level } });
  return rows.map((row) => ({
    objectiveId: row.objectiveId,
    criterionVersion: row.criterionVersion,
    policyVersion: row.policyVersion,
    level: row.level,
    skill: row.skill,
    mastery: row.mastery,
    assessedTasks: row.assessedTasks,
    assessedSessions: row.assessedSessions,
    lastQuality: row.lastQuality,
    lastReviewed: row.lastReviewed?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
  }));
}

export async function learningTransitionBlockers(
  database: Prisma.TransactionClient,
  courseId: string
) {
  const [activeClass, preparation, practice] = await Promise.all([
    database.courseClass.findFirst({
      where: { courseId, status: { not: 'PASSED' } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    }),
    classPreparationStore(database, courseId).read(),
    database.practiceSession.findFirst({
      where: {
        courseId,
        OR: [
          { status: 'GENERATING' },
          { generationState: { path: ['status'], equals: 'UNRESOLVED' } },
          { generationState: { path: ['status'], equals: 'CANCELLING' } },
        ],
      },
      select: { id: true },
    }),
  ]);
  const blockers: string[] = [];
  if (activeClass) blockers.push('Finish the current course class before advancing.');
  if (preparation && ['QUEUED', 'RUNNING', 'CANCELLING', 'UNRESOLVED'].includes(preparation.status))
    blockers.push('Settle the current class preparation before advancing.');
  if (practice) blockers.push('Settle pending practice generation before advancing.');
  return blockers;
}

export interface LearningMapNodeView {
  node: LearningNode;
  progress: ObjectiveProgress | null;
  summary: { total: number; confident: number; notAssessed: number; reviewDue: number };
}

export async function readLearningMap(
  database: Prisma.TransactionClient,
  course: LearningCourse,
  viewedLevel = course.currentLevel
) {
  const [{ catalog, catalogHash, binding }, states] = await Promise.all([
    readCourseCatalog(database, { ...course, currentLevel: viewedLevel }),
    readObjectiveStates(database, course.id, viewedLevel),
  ]);
  const exemptSkills = binding ? learningCoverageExemptions(binding.coverage) : [];
  const statesByObjective = new Map<string, ObjectiveEvidenceState[]>();
  for (const state of states) {
    const previous = statesByObjective.get(state.objectiveId) ?? [];
    previous.push(state);
    statesByObjective.set(state.objectiveId, previous);
  }
  const now = new Date();
  const selected = catalog.nodes.filter(
    (node) => node.kind === 'GROUP' || node.level === viewedLevel
  );
  const byId = new Map(selected.map((node) => [node.id, node]));
  const summaries = new Map<string, LearningMapNodeView['summary']>();
  const progressById = new Map<string, ObjectiveProgress>();
  for (const node of selected) {
    if (node.kind !== 'OBJECTIVE') continue;
    const progress = objectiveProgress(
      node,
      statesByObjective.get(node.id) ?? [],
      exemptSkills,
      now
    );
    progressById.set(node.id, progress);
    let current: LearningNode | undefined = node;
    while (current) {
      const summary = summaries.get(current.id) ?? {
        total: 0,
        confident: 0,
        notAssessed: 0,
        reviewDue: 0,
      };
      summary.total++;
      if (progress.status === 'CONFIDENT') summary.confident++;
      if (progress.status === 'NOT_ASSESSED') summary.notAssessed++;
      if (progress.reviewDue) summary.reviewDue++;
      summaries.set(current.id, summary);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
  }
  const readiness = evaluateLevelReadiness(catalog, viewedLevel, states, exemptSkills, now);
  const blockers =
    viewedLevel === course.currentLevel
      ? await learningTransitionBlockers(database, course.id)
      : [];
  const completion = await database.learningLevelCompletion.findUnique({
    where: { courseId_level: { courseId: course.id, level: viewedLevel } },
    select: { completedAt: true },
  });
  return {
    courseId: course.id,
    targetLang: course.targetLang,
    currentLevel: course.currentLevel,
    viewedLevel,
    catalogVersion: catalog.version,
    catalogHash,
    requirementId: binding?.id ?? null,
    readiness,
    blockers,
    completedAt: completion?.completedAt.toISOString() ?? null,
    references: catalog.references,
    nodes: selected
      .filter((node) => summaries.has(node.id))
      .map((node): LearningMapNodeView => ({
        node,
        progress: progressById.get(node.id) ?? null,
        summary: summaries.get(node.id)!,
      })),
  };
}
