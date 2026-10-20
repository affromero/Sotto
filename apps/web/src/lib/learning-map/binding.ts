import {
  skillRequirementsSchema,
  type SkillRequirements,
  type CefrLevel,
  type LearningSkill,
} from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { getLanguageCatalog } from './catalogs';
import { publishLearningCatalog, readPublishedLearningCatalog } from './catalog';

export interface LearningCourse {
  id: string;
  userId: string;
  nativeLang: string;
  targetLang: string;
  currentLevel: CefrLevel;
}

export function learningCoverageExemptions(input: unknown): LearningSkill[] {
  const coverage = skillRequirementsSchema.parse(input);
  if (coverage.scope !== 'CLASS')
    throw new Error('Level coverage requires a complete class policy.');
  return (['LISTENING', 'SPEAKING'] as const).filter(
    (skill) => coverage.skills[skill].state === 'EXEMPT_NO_PROVIDER'
  );
}

/** Call inside the owned admission transaction. Coverage changes do not rewrite a pinned band. */
export async function ensureLearningLevelBinding(
  database: Prisma.TransactionClient,
  course: LearningCourse,
  level: CefrLevel,
  inputCoverage: SkillRequirements
) {
  const coverage = skillRequirementsSchema.parse(inputCoverage);
  learningCoverageExemptions(coverage);
  if (
    coverage.level !== level ||
    coverage.targetLang !== course.targetLang ||
    coverage.nativeLang !== course.nativeLang
  )
    throw new Error('Learning coverage does not match this course and level.');
  const existing = await database.learningLevelBinding.findUnique({
    where: { courseId_level: { courseId: course.id, level } },
    include: { revision: true },
  });
  if (existing) {
    readBoundCatalog(existing);
    if (existing.revision.targetLang !== course.targetLang)
      throw new Error('Level binding target language changed.');
    return existing;
  }
  const revision = await publishLearningCatalog(database, getLanguageCatalog(course.targetLang));
  return database.learningLevelBinding.upsert({
    where: { courseId_level: { courseId: course.id, level } },
    create: {
      courseId: course.id,
      level,
      revisionId: revision.id,
      policyVersion: 1,
      coverage: coverage as unknown as Prisma.InputJsonValue,
    },
    update: {},
    include: { revision: true },
  });
}

export function readBoundCatalog(binding: {
  revision: { targetLang: string; definition: unknown; version: number; catalogHash: string };
  coverage: unknown;
  level: CefrLevel;
  policyVersion: number;
}) {
  const catalog = readPublishedLearningCatalog(binding.revision);
  const coverage = skillRequirementsSchema.parse(binding.coverage);
  if (
    catalog.targetLang !== coverage.targetLang ||
    coverage.level !== binding.level ||
    binding.policyVersion !== 1 ||
    catalog.nodes.some(
      (node) =>
        node.kind === 'OBJECTIVE' &&
        node.level === binding.level &&
        node.policyVersion !== binding.policyVersion
    )
  )
    throw new Error('A pinned learning requirement set has inconsistent language or difficulty.');
  return { catalog, coverage, exemptSkills: learningCoverageExemptions(coverage) };
}
