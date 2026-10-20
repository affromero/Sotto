import { isDeepStrictEqual } from 'node:util';
import {
  learningSelectionSnapshotSchema,
  type SkillRequirements,
  type LearningSelectionSnapshot,
  type CefrLevel,
} from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { ensureLearningLevelBinding, readBoundCatalog } from '../binding';
import { languageCatalogAvailability } from '../catalogs';
import { resolveSkillRequirementsInTransaction } from '@/lib/learning/skill-requirements';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { objectiveAssessmentScopeSchema } from './protocol';

/** Teaching links supply candidates. Only an independent exact-task review can qualify assessment. */
export async function captureObjectiveAssessmentScope(
  database: Prisma.TransactionClient,
  input: {
    courseId: string;
    userId: string;
    execution: SottoProviderExecution;
    level: CefrLevel;
    requirements: SkillRequirements;
    selection?: LearningSelectionSnapshot | null;
    objectiveIds?: readonly string[];
    grammarKeys?: readonly string[];
  }
) {
  const actor = await input.execution.authorize(database);
  const course = await database.course.findFirst({
    where: { id: input.courseId, userId: input.userId },
  });
  if (!course || actor.userId !== input.userId || input.execution.userId !== input.userId)
    throw new Error('Assessment scope requires its owned course.');
  if (
    input.requirements.level !== input.level ||
    input.requirements.nativeLang !== course.nativeLang ||
    input.requirements.targetLang !== course.targetLang
  )
    throw new Error('Assessment requirements changed language or difficulty.');
  const selected = input.selection ? learningSelectionSnapshotSchema.parse(input.selection) : null;
  if (selected && (selected.targetLang !== course.targetLang || selected.level !== input.level))
    throw new Error('Assessment selection changed language or difficulty.');
  if (selected && selected.objectives.length === 0) return null;
  let binding = await database.learningLevelBinding.findUnique({
    where: { courseId_level: { courseId: course.id, level: input.level } },
    include: { revision: true },
  });
  if (!binding) {
    if (languageCatalogAvailability(course.targetLang).status === 'UNAVAILABLE') {
      if (input.selection)
        throw new Error('Selected assessment objectives require an available catalog.');
      return null;
    }
    const coverage = await resolveSkillRequirementsInTransaction(database, input.execution, {
      scope: 'CLASS',
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
      level: input.level,
    });
    binding = await ensureLearningLevelBinding(database, course, input.level, coverage);
  }
  const { catalog } = readBoundCatalog(binding);
  if (
    selected &&
    (selected.catalogHash !== binding.revision.catalogHash ||
      selected.catalogVersion !== catalog.version ||
      selected.targetLang !== course.targetLang ||
      selected.level !== input.level)
  )
    throw new Error('Assessment selection does not match the pinned language catalog.');
  const ids = new Set(
    selected?.objectives.map((objective) => objective.id) ?? input.objectiveIds ?? []
  );
  for (const key of selected ? [] : (input.grammarKeys ?? [])) {
    const matches = catalog.nodes.filter(
      (node) =>
        node.kind === 'OBJECTIVE' && node.level === input.level && node.grammarKeys.includes(key)
    );
    if (matches.length === 1) ids.add(matches[0]!.id);
  }
  const criteria = [];
  for (const id of ids) {
    const objective = catalog.nodes.find((node) => node.id === id);
    if (objective?.kind !== 'OBJECTIVE' || objective.level !== input.level)
      throw new Error('Assessment candidate has a different language, kind or difficulty.');
    const snapshot = selected?.objectives.find((node) => node.id === id);
    if (
      snapshot &&
      (snapshot.criterionVersion !== objective.criterionVersion ||
        snapshot.policyVersion !== objective.policyVersion ||
        !isDeepStrictEqual(snapshot.skillCriteria, objective.skillCriteria))
    )
      throw new Error('Assessment candidate changed its pinned criterion.');
    for (const skill of objective.skills) {
      if (input.requirements.skills[skill].state !== 'REQUIRED') continue;
      criteria.push({
        objectiveId: id,
        criterionVersion: objective.criterionVersion,
        policyVersion: objective.policyVersion,
        level: objective.level,
        skill,
        assessment: objective.skillCriteria[skill]!,
      });
    }
  }
  if (!criteria.length) return null;
  return objectiveAssessmentScopeSchema.parse({
    schemaVersion: 1,
    courseId: course.id,
    userId: input.userId,
    bindingId: binding.id,
    catalogHash: binding.revision.catalogHash,
    targetLang: course.targetLang,
    level: input.level,
    criteria,
  });
}
