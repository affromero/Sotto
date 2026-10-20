import {
  learningLevels,
  objectiveProgress,
  type CefrLevel,
  type LearningObjectiveMemory,
} from '@sotto/shared';
import { prisma } from '../prisma';
import { readBoundCatalog } from './binding';
import { readObjectiveStates } from './objective-state';

/** Read only pinned qualified projections. Legacy grammar strength never supplies objective evidence. */
export async function readCourseObjectiveMemory(courseId: string, now: Date) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { nativeLang: true, targetLang: true, currentLevel: true },
  });
  if (!course) throw new Error('Course memory requires an existing course.');
  const bindings = await prisma.learningLevelBinding.findMany({
    where: { courseId },
    include: { revision: true },
  });
  const objectives: LearningObjectiveMemory[] = [];
  const legacyGrammarExclusions: Array<{ cefrLevel: CefrLevel; topicKey: { in: string[] } }> = [];
  for (const binding of bindings.sort(
    (left, right) => learningLevels.indexOf(left.level) - learningLevels.indexOf(right.level)
  )) {
    if (learningLevels.indexOf(binding.level) > learningLevels.indexOf(course.currentLevel))
      continue;
    const { catalog, coverage, exemptSkills } = readBoundCatalog(binding);
    if (catalog.targetLang !== course.targetLang || coverage.nativeLang !== course.nativeLang)
      throw new Error('The pinned objective memory belongs to another language pair.');
    const states = await readObjectiveStates(prisma, courseId, binding.level);
    const aliases = new Map<string, Set<string>>();
    for (const objective of catalog.nodes) {
      if (objective.kind !== 'OBJECTIVE' || objective.level !== binding.level) continue;
      objectives.push({
        objective,
        catalogVersion: catalog.version,
        catalogHash: binding.revision.catalogHash,
        requirementId: binding.id,
        progress: objectiveProgress(objective, states, exemptSkills, now),
      });
      if (objective.branch !== 'GRAMMAR') continue;
      for (const key of objective.grammarKeys) {
        const matches = aliases.get(key) ?? new Set<string>();
        matches.add(objective.id);
        aliases.set(key, matches);
      }
    }
    const exact = [...aliases]
      .filter(([, matches]) => matches.size === 1)
      .map(([key]) => key)
      .sort();
    if (exact.length)
      legacyGrammarExclusions.push({ cefrLevel: binding.level, topicKey: { in: exact } });
  }
  objectives.sort(
    (left, right) =>
      learningLevels.indexOf(left.objective.level) -
        learningLevels.indexOf(right.objective.level) ||
      left.objective.order - right.objective.order ||
      left.objective.id.localeCompare(right.objective.id)
  );
  return { objectives, legacyGrammarExclusions };
}

/** The projection owns review due dates. This reader never updates a schedule or awards credit. */
export function dueObjectiveMemory(objectives: readonly LearningObjectiveMemory[], limit: number) {
  const dueAt = (entry: LearningObjectiveMemory) =>
    Math.min(
      ...entry.progress.skills.flatMap((skill) =>
        !skill.exempt && skill.evidence?.dueAt ? [new Date(skill.evidence.dueAt).getTime()] : []
      )
    );
  return objectives
    .filter((entry) => entry.progress.reviewDue || entry.progress.status === 'NEEDS_WORK')
    .sort(
      (left, right) =>
        dueAt(left) - dueAt(right) || left.objective.id.localeCompare(right.objective.id)
    )
    .slice(0, limit);
}
