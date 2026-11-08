import type { LearningDatabase } from '../../database';

/** Historical material stays owned; only the newest section attempt is active. */
export function currentClassSections<
  T extends { skill: string; attempt: number; withdrawn: boolean },
>(sections: readonly T[]): T[] {
  const newest = new Map<string, number>();
  for (const section of sections)
    if (section.withdrawn === false)
      newest.set(section.skill, Math.max(newest.get(section.skill) ?? 0, section.attempt));
  return sections.filter(
    (section) => section.withdrawn === false && section.attempt === newest.get(section.skill)
  );
}

export async function isCurrentClassSection(
  database: LearningDatabase,
  section: {
    withdrawn: boolean;
    classId: string;
    skill: import('@sotto/shared').SkillType;
    attempt: number;
  }
): Promise<boolean> {
  if (section.withdrawn !== false) return false;
  return !(await database.classSection.findFirst({
    where: {
      classId: section.classId,
      skill: section.skill,
      withdrawn: false,
      attempt: { gt: section.attempt },
    },
    select: { id: true },
  }));
}
