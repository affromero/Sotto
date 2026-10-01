import type { LearningDatabase } from '../database';

/** Historical material stays owned; only the newest section attempt is active. */
export function currentClassSections<T extends { skill: string; attempt: number }>(
  sections: readonly T[]
): T[] {
  const newest = new Map<string, number>();
  for (const section of sections)
    newest.set(section.skill, Math.max(newest.get(section.skill) ?? 0, section.attempt));
  return sections.filter((section) => section.attempt === newest.get(section.skill));
}

export async function isCurrentClassSection(
  database: LearningDatabase,
  section: { classId: string; skill: import('@sotto/shared').SkillType; attempt: number }
): Promise<boolean> {
  return !(await database.classSection.findFirst({
    where: { classId: section.classId, skill: section.skill, attempt: { gt: section.attempt } },
    select: { id: true },
  }));
}
