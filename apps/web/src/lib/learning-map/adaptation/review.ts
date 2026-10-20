import type {
  CefrLevel,
  LearningObjectiveMemory,
  LearningSkill,
  PracticeKind,
} from '@sotto/shared';

export interface ObjectiveReviewScope {
  level: CefrLevel;
  targetLang?: string;
  kind: PracticeKind;
}

/** Read qualified channel states only. Recommendations never assess or schedule a learner. */
export function objectiveReviewSkills(entry: LearningObjectiveMemory, now: Date): LearningSkill[] {
  return entry.progress.skills
    .filter(
      (skill) =>
        !skill.exempt &&
        (skill.status === 'NEEDS_WORK' ||
          (skill.evidence?.dueAt !== null &&
            skill.evidence?.dueAt !== undefined &&
            new Date(skill.evidence.dueAt).getTime() <= now.getTime()))
    )
    .map((skill) => skill.skill);
}

export function objectiveReviewTargets(
  entries: readonly LearningObjectiveMemory[],
  scope: ObjectiveReviewScope,
  now: Date
) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (
      entry.objective.level !== scope.level ||
      (scope.targetLang && !entry.objective.id.startsWith(`${scope.targetLang}.`)) ||
      seen.has(entry.objective.id)
    )
      return false;
    const skills = objectiveReviewSkills(entry, now);
    if (!skills.length || (scope.kind !== 'FULL' && !skills.some((skill) => skill === scope.kind)))
      return false;
    seen.add(entry.objective.id);
    return true;
  });
}

/** Keep whole criteria within a bounded prompt. These targets do not broaden assessment authority. */
export function objectiveReviewContext(
  entries: readonly LearningObjectiveMemory[],
  scope: ObjectiveReviewScope,
  now: Date
) {
  const selected: LearningObjectiveMemory[] = [];
  const blocks: string[] = [];
  let length = 0;
  for (const entry of objectiveReviewTargets(entries, scope, now)) {
    const skills = objectiveReviewSkills(entry, now).filter(
      (skill) => scope.kind === 'FULL' || skill === scope.kind
    );
    const block = [
      `${entry.objective.id} (${entry.objective.level}, criterion ${entry.objective.criterionVersion}, policy ${entry.objective.policyVersion}, catalog ${entry.catalogVersion}/${entry.catalogHash})`,
      entry.objective.title,
      ...skills.map((skill) => `${skill}: ${entry.objective.skillCriteria[skill]}`),
    ].join('\n');
    if (selected.length === 4 || length + block.length > 12000) continue;
    selected.push(entry);
    blocks.push(block);
    length += block.length;
  }
  return {
    entries: selected,
    text: blocks.length
      ? `Qualified objectives recommended for review at ${scope.level}. Preserve the named meaning and skill criteria. Recommendation context does not establish mastery or expand the frozen assessment scope.\n${blocks.join('\n\n')}`
      : '',
  };
}

export function objectiveReviewCounts(
  entries: readonly LearningObjectiveMemory[],
  scope: ObjectiveReviewScope,
  now: Date
) {
  const targets = objectiveReviewTargets(entries, scope, now);
  const bySkill: Partial<Record<LearningSkill, number>> = {};
  for (const entry of targets)
    for (const skill of objectiveReviewSkills(entry, now))
      bySkill[skill] = (bySkill[skill] ?? 0) + 1;
  return { objectives: targets.length, bySkill };
}
