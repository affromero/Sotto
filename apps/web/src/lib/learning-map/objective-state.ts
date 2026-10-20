import type { CefrLevel, ObjectiveEvidenceState } from '@sotto/shared';
import type { LearnerObjectiveState } from '@/generated/prisma/client';

interface ObjectiveStateDatabase {
  learnerObjectiveState: {
    findMany(input: {
      where: { courseId: string; level: CefrLevel };
    }): Promise<readonly LearnerObjectiveState[]>;
  };
}

/** Shared read projection used by the map, adaptive due list and memory graph. */
export async function readObjectiveStates(
  database: ObjectiveStateDatabase,
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
