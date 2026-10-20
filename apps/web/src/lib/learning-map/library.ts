import { z } from 'zod';
import {
  learningObjectiveDetailSchema,
  learningObjectiveHistorySchema,
  courseAnalysisListSchema,
  type CefrLevel,
} from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { readLearningMap, LearningMapError } from './read';
import type { LearningCourse } from './binding';
import { materialAnalysisStatusIdentity } from '../course-materials/analysis/admission';

const cursorSchema = z.object({ at: z.iso.datetime(), id: z.string().min(1).max(200) }).strict();
const assessmentSchema = z.object({
  assessment: z.string(),
  rationale: z.string(),
});

function readCursor(cursor: string | undefined) {
  if (cursor === undefined) return null;
  if (cursor.length > 1000) throw new LearningMapError('Invalid history cursor.', 400);
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new LearningMapError('Invalid history cursor.', 400);
  }
}
const nextCursor = (at: Date, id: string) =>
  Buffer.from(JSON.stringify({ at: at.toISOString(), id })).toString('base64url');

export async function readCourseAnalyses(
  database: Prisma.TransactionClient,
  course: LearningCourse,
  cursor?: string
) {
  const after = readCursor(cursor);
  const rows = await database.materialAnalysis.findMany({
    where: {
      userId: course.userId,
      attachedCourseId: course.id,
      ...(after
        ? {
            OR: [
              { createdAt: { lt: new Date(after.at) } },
              { createdAt: new Date(after.at), id: { lt: after.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 21,
    include: {
      sources: { orderBy: { order: 'asc' }, select: { name: true } },
      _count: { select: { focuses: true } },
    },
  });
  const page = rows.slice(0, 20);
  return courseAnalysisListSchema.parse({
    courseId: course.id,
    items: page.map((row) => ({
      ...materialAnalysisStatusIdentity(row),
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      retryOfAnalysisId: row.retryOfAnalysisId,
      sourceNames: row.sources.map((source) => source.name),
      focusCount: row._count.focuses,
    })),
    nextCursor: rows.length > 20 ? nextCursor(page[19].createdAt, page[19].id) : null,
  });
}

export async function readLearningObjective(
  database: Prisma.TransactionClient,
  course: LearningCourse,
  objectiveId: string,
  level: CefrLevel
) {
  const map = await readLearningMap(database, course, level);
  const entry = map.nodes.find((item) => item.node.id === objectiveId);
  if (!entry || entry.node.kind !== 'OBJECTIVE' || !entry.progress)
    throw new LearningMapError('Objective not found at this course level.', 404);
  const byId = new Map(map.nodes.map((item) => [item.node.id, item.node]));
  const ancestors = [];
  let parentId: string | null = entry.node.parentId;
  while (parentId !== null) {
    const parent = byId.get(parentId);
    if (!parent || parent.kind !== 'GROUP')
      throw new LearningMapError('The objective hierarchy is unavailable.', 409);
    ancestors.unshift(parent);
    parentId = parent.parentId;
  }
  return learningObjectiveDetailSchema.parse({
    courseId: course.id,
    catalogVersion: map.catalogVersion,
    catalogHash: map.catalogHash,
    requirementId: map.requirementId,
    objective: entry.node,
    ancestors,
    progress: entry.progress,
  });
}

export async function readLearningObjectiveHistory(
  database: Prisma.TransactionClient,
  course: LearningCourse,
  objectiveId: string,
  level: CefrLevel,
  cursor?: string
) {
  const detail = await readLearningObjective(database, course, objectiveId, level);
  const after = readCursor(cursor);
  const rows = await database.learningObservation.findMany({
    where: {
      courseId: course.id,
      objectiveId,
      level,
      criterionVersion: detail.objective.criterionVersion,
      policyVersion: detail.objective.policyVersion,
      ...(after
        ? {
            OR: [
              { observedAt: { lt: new Date(after.at) } },
              { observedAt: new Date(after.at), id: { lt: after.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
    take: 51,
  });
  const page = rows.slice(0, 50);
  return learningObjectiveHistorySchema.parse({
    courseId: course.id,
    objectiveId,
    criterionVersion: detail.objective.criterionVersion,
    policyVersion: detail.objective.policyVersion,
    items: page.map((row) => ({
      id: row.id,
      skill: row.skill,
      quality: row.quality,
      sourceType: row.sourceType,
      sessionId: row.sessionId,
      taskId: row.taskId,
      observedAt: row.observedAt.toISOString(),
      ...assessmentSchema.parse(row.evidence),
    })),
    nextCursor: rows.length > 50 ? nextCursor(page[49].observedAt, page[49].id) : null,
  });
}
