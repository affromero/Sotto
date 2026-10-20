import {
  createSkillRequirements,
  objectiveProgress,
  type LearningObjective,
  type LearningObjectiveMemory,
  type LearningSkill,
} from '@sotto/shared';
import { getLanguageCatalog } from '@/lib/learning-map/catalogs';
import { learningCatalogHash } from '@/lib/learning-map/catalog';

export function reviewFixture(
  branch: 'GRAMMAR' | 'SITUATIONS' = 'GRAMMAR',
  level: 'A1' | 'A2' = 'A1'
) {
  const catalog = getLanguageCatalog('es');
  const objective = catalog.nodes.find(
    (node): node is LearningObjective =>
      node.kind === 'OBJECTIVE' && node.branch === branch && node.level === level
  );
  if (!objective) throw new Error('Missing reviewed fixture objective.');
  const past = new Date('2020-01-01T00:00:00Z');
  const states = objective.skills.map((skill) => ({
    objectiveId: objective.id,
    criterionVersion: objective.criterionVersion,
    policyVersion: objective.policyVersion,
    level: objective.level,
    skill,
    mastery: 0.3,
    assessedTasks: 2,
    assessedSessions: 1,
    lastQuality: 0.3,
    lastReviewed: past,
    dueAt: new Date('2099-01-01T00:00:00Z'),
  }));
  const entry: LearningObjectiveMemory = {
    objective,
    catalogHash: learningCatalogHash(catalog),
    catalogVersion: catalog.version,
    requirementId: 'requirement-review',
    progress: objectiveProgress(
      objective,
      states.map((state) => ({
        ...state,
        lastReviewed: state.lastReviewed.toISOString(),
        dueAt: state.dueAt.toISOString(),
      })),
      [],
      new Date()
    ),
  };
  return {
    entry,
    states,
    binding: {
      id: entry.requirementId,
      level,
      policyVersion: 1,
      coverage: createSkillRequirements({
        scope: 'CLASS',
        nativeLang: 'en',
        targetLang: 'es',
        level,
        ttsProvider: null,
        sttProvider: null,
      }),
      revision: {
        targetLang: 'es',
        definition: catalog,
        version: catalog.version,
        catalogHash: entry.catalogHash,
      },
    },
  };
}

export function onlyReviewSkill(
  entry: LearningObjectiveMemory,
  skill: LearningSkill
): LearningObjectiveMemory {
  return {
    ...entry,
    progress: {
      ...entry.progress,
      skills: entry.progress.skills.map((channel) =>
        channel.skill === skill ? channel : { ...channel, status: 'NOT_ASSESSED', evidence: null }
      ),
    },
  };
}
