import { z } from 'zod';
import {
  learningLevelSchema,
  learningSkillSchema,
  nextLearningLevel,
  type LearningCatalog,
  type LearningLevel,
  type LearningObjective,
  type LearningSkill,
} from './catalog';

export const OBJECTIVE_MASTERY_POLICY = Object.freeze({
  version: 1,
  prior: 0.5,
  confidentPosterior: 0.85,
  minimumTasks: 5,
  minimumSessions: 2,
  sessionWeightLimit: 1,
});

export const objectiveEvidenceStateSchema = z.object({
  objectiveId: z.string().min(1),
  criterionVersion: z.number().int().positive(),
  policyVersion: z.number().int().positive(),
  level: learningLevelSchema,
  skill: learningSkillSchema,
  mastery: z.number().finite().min(0).max(1),
  assessedTasks: z.number().int().nonnegative(),
  assessedSessions: z.number().int().nonnegative(),
  lastQuality: z.number().finite().min(0).max(1).nullable(),
  lastReviewed: z.iso.datetime().nullable(),
  dueAt: z.iso.datetime().nullable(),
});
export type ObjectiveEvidenceState = z.infer<typeof objectiveEvidenceStateSchema>;
export type ObjectiveStatus = 'NOT_ASSESSED' | 'PRACTISING' | 'CONFIDENT' | 'NEEDS_WORK';

export function objectiveEvidenceStatus(state?: ObjectiveEvidenceState): ObjectiveStatus {
  if (!state || state.assessedTasks === 0) return 'NOT_ASSESSED';
  if (state.lastQuality !== null && state.lastQuality < 0.6) return 'NEEDS_WORK';
  if (
    state.mastery >= OBJECTIVE_MASTERY_POLICY.confidentPosterior &&
    state.assessedTasks >= OBJECTIVE_MASTERY_POLICY.minimumTasks &&
    state.assessedSessions >= OBJECTIVE_MASTERY_POLICY.minimumSessions
  )
    return 'CONFIDENT';
  return 'PRACTISING';
}

export interface ObjectiveSkillProgress {
  skill: LearningSkill;
  status: ObjectiveStatus;
  exempt: boolean;
  evidence: ObjectiveEvidenceState | null;
}
export interface ObjectiveProgress {
  objectiveId: string;
  status: ObjectiveStatus;
  reviewDue: boolean;
  skills: ObjectiveSkillProgress[];
}

export function objectiveProgress(
  objective: LearningObjective,
  states: readonly ObjectiveEvidenceState[],
  exemptSkills: readonly LearningSkill[],
  now: Date
): ObjectiveProgress {
  z.array(z.enum(['LISTENING', 'SPEAKING'])).parse(exemptSkills);
  const skills = objective.skills.map((skill): ObjectiveSkillProgress => {
    const state = states.find(
      (candidate) =>
        candidate.objectiveId === objective.id &&
        candidate.criterionVersion === objective.criterionVersion &&
        candidate.policyVersion === objective.policyVersion &&
        candidate.policyVersion === OBJECTIVE_MASTERY_POLICY.version &&
        candidate.level === objective.level &&
        candidate.skill === skill
    );
    return {
      skill,
      status: objectiveEvidenceStatus(state),
      exempt: exemptSkills.includes(skill),
      evidence: state ?? null,
    };
  });
  const required = skills.filter((skill) => !skill.exempt);
  const status: ObjectiveStatus =
    required.length > 0 && required.every((skill) => skill.status === 'CONFIDENT')
      ? 'CONFIDENT'
      : required.some((skill) => skill.status === 'NEEDS_WORK')
        ? 'NEEDS_WORK'
        : required.some((skill) => skill.status !== 'NOT_ASSESSED')
          ? 'PRACTISING'
          : 'NOT_ASSESSED';
  return {
    objectiveId: objective.id,
    status,
    skills,
    reviewDue: skills.some(
      (skill) =>
        !skill.exempt &&
        skill.evidence?.dueAt !== null &&
        skill.evidence?.dueAt !== undefined &&
        new Date(skill.evidence.dueAt).getTime() <= now.getTime()
    ),
  };
}

export interface LevelReadiness {
  level: LearningLevel;
  nextLevel: LearningLevel | null;
  ready: boolean;
  requiredCount: number;
  confidentCount: number;
  unassessedCount: number;
  practisingCount: number;
  needsWorkCount: number;
  missingObjectiveIds: string[];
  exemptSkills: LearningSkill[];
}

export function evaluateLevelReadiness(
  catalog: LearningCatalog,
  level: LearningLevel,
  states: readonly ObjectiveEvidenceState[],
  exemptSkills: readonly LearningSkill[],
  now: Date
): LevelReadiness {
  const required = catalog.nodes.filter(
    (node): node is LearningObjective =>
      node.kind === 'OBJECTIVE' && node.level === level && node.required
  );
  const progress = required.map((objective) =>
    objectiveProgress(objective, states, exemptSkills, now)
  );
  const count = (status: ObjectiveStatus) =>
    progress.filter((item) => item.status === status).length;
  const missingObjectiveIds = progress
    .filter((item) => item.status !== 'CONFIDENT')
    .map((item) => item.objectiveId);
  return {
    level,
    nextLevel: nextLearningLevel(level),
    ready: required.length > 0 && missingObjectiveIds.length === 0,
    requiredCount: required.length,
    confidentCount: count('CONFIDENT'),
    unassessedCount: count('NOT_ASSESSED'),
    practisingCount: count('PRACTISING'),
    needsWorkCount: count('NEEDS_WORK'),
    missingObjectiveIds,
    exemptSkills: [...exemptSkills],
  };
}
