import { learningSkills, type SkillType } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { readPrerequisiteSource } from '@/lib/classes/help/content/prerequisite-source';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { classRequirementsOrLegacy } from '../../skill-requirements';
import { currentClassSections } from '../progress/current-sections';
import {
  assessmentFormativeRevision,
  AssessmentNotRequiredError,
} from './assessment-formative-revision';

export class AssessmentSourceConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssessmentSourceConflict';
  }
}

/** Private provider input, captured within an authorized transaction, not publication authority. */
export async function captureAssessmentGenerationSource(
  database: Prisma.TransactionClient,
  execution: SottoProviderExecution,
  expected: { classId: string; classAttempt: number }
) {
  execution.signal?.throwIfAborted();
  const actor = await execution.authorize(database);
  if (actor.userId !== execution.userId)
    throw new AssessmentSourceConflict('Assessment learner changed.');
  await database.$queryRaw`SELECT c.id FROM "CourseClass" c JOIN "Course" o ON o.id = c."courseId" WHERE c.id = ${expected.classId} AND o."userId" = ${actor.userId} FOR UPDATE OF c`;
  const cls = await database.courseClass.findFirst({
    where: { id: expected.classId, course: { userId: actor.userId } },
    select: {
      id: true,
      courseId: true,
      attempt: true,
      status: true,
      skillRequirements: true,
      course: { select: { nativeLang: true, targetLang: true } },
      lesson: { select: { level: true } },
      sections: {
        select: { id: true, skill: true, attempt: true, withdrawn: true, passThreshold: true },
      },
    },
  });
  if (
    !cls ||
    cls.attempt !== expected.classAttempt ||
    !['AVAILABLE', 'IN_PROGRESS'].includes(cls.status)
  )
    throw new AssessmentSourceConflict('Assessment class or attempt changed.');
  const formative = await assessmentFormativeRevision(database, cls.id, actor.userId).catch(
    (error: unknown) => {
      if (error instanceof AssessmentNotRequiredError)
        throw new AssessmentSourceConflict(error.message);
      throw error;
    }
  );
  const source = await readPrerequisiteSource(database, cls.id, actor.userId);
  const requirements = classRequirementsOrLegacy(cls.skillRequirements, {
    nativeLang: cls.course.nativeLang,
    targetLang: cls.course.targetLang,
    level: cls.lesson.level,
  });
  if (
    requirements.scope !== 'CLASS' ||
    requirements.level !== 'A1' ||
    requirements.nativeLang !== cls.course.nativeLang ||
    requirements.targetLang !== cls.course.targetLang
  )
    throw new AssessmentSourceConflict('Assessment requirements changed.');
  const sections = currentClassSections(cls.sections);
  const thresholds: Partial<Record<SkillType, number>> = {};
  for (const skill of learningSkills) {
    if (requirements.skills[skill].state !== 'REQUIRED') continue;
    const matches = sections.filter((section) => section.skill === skill);
    const section = matches[0];
    if (
      matches.length !== 1 ||
      !section ||
      !Number.isFinite(section.passThreshold) ||
      section.passThreshold < 0 ||
      section.passThreshold > 1 ||
      !source.source.sections.some((item) => item.id === section.id && item.skill === skill)
    )
      throw new AssessmentSourceConflict('Assessment skill thresholds are unavailable.');
    thresholds[skill] = section.passThreshold;
  }
  const prerequisite = formative.addendum?.content ?? null;
  const currentActor = await execution.authorize(database);
  if (currentActor.userId !== actor.userId)
    throw new AssessmentSourceConflict('Assessment learner changed.');
  execution.signal?.throwIfAborted();
  return {
    classId: cls.id,
    courseId: cls.courseId,
    userId: actor.userId,
    classAttempt: cls.attempt,
    ownership: source.ownership,
    formativeRevision: formative.revision,
    teachingReceipt: formative.teachingReceipt,
    requirements,
    thresholds,
    source: source.source,
    prerequisite,
  };
}
