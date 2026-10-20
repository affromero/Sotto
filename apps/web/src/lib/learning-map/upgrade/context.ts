import { z } from 'zod';
import {
  learningUpgradeCursorSchema,
  type LearningUpgradeCursor,
  type LearningCatalog,
  type LearningObjective,
} from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { resolveSkillRequirementsInTransaction } from '@/lib/learning/skill-requirements';
import { readBoundCatalog } from '@/lib/learning-map/binding';
import { languageCatalogAvailability } from '@/lib/learning-map/catalogs';
import { learningCatalogHash, readPublishedLearningCatalog } from '@/lib/learning-map/catalog';
import { LearningMapError } from '@/lib/learning-map/read';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';

export const upgradeDigest = (value: unknown) =>
  learningProviderInputHash(JSON.parse(JSON.stringify(value)));
export const encodeUpgradeCursor = (value: LearningUpgradeCursor) =>
  Buffer.from(JSON.stringify(learningUpgradeCursorSchema.parse(value))).toString('base64url');
export function decodeUpgradeCursor(value: string): LearningUpgradeCursor {
  if (value.length > 4096 || !/^[a-zA-Z0-9_-]+$/.test(value))
    throw new LearningMapError('Invalid upgrade cursor.', 400);
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf8', { fatal: true }).decode(Buffer.from(value, 'base64url'))
    );
  } catch {
    throw new LearningMapError('Invalid upgrade cursor.', 400);
  }
  const cursor = learningUpgradeCursorSchema.parse(parsed);
  if (new Date(cursor.cutoff).getTime() > Date.now() + 60000)
    throw new LearningMapError('The upgrade cutoff is in the future.', 400);
  return cursor;
}
export async function upgradeContext(
  database: Prisma.TransactionClient,
  execution: SottoProviderExecution,
  courseId: string,
  lock: boolean
) {
  const actor = await execution.authorize(database);
  if (actor.userId !== execution.userId)
    throw new LearningMapError('The upgrade recipient changed.', 409);
  if (lock)
    await database.$queryRaw`SELECT id FROM "Course" WHERE id=${courseId} AND "userId"=${actor.userId} FOR UPDATE`;
  const course = await database.course.findFirst({
    where: { id: courseId, userId: actor.userId },
    include: { user: { select: { createdAt: true } } },
  });
  if (!course) throw new LearningMapError('Course not found.', 404);
  const binding = await database.learningLevelBinding.findUnique({
    where: { courseId_level: { courseId, level: course.currentLevel } },
    include: { revision: true },
  });
  const available = languageCatalogAvailability(course.targetLang);
  const published = await database.learningMapRevision.findFirst({
    where: { targetLang: course.targetLang },
    orderBy: { version: 'desc' },
  });
  const latest = published ? readPublishedLearningCatalog(published) : null;
  const local = available.status === 'PUBLISHED' ? available.catalog : null;
  const upgradeCatalog = latest && (!local || latest.version > local.version) ? latest : local;
  const bound = binding ? readBoundCatalog(binding) : null;
  if (
    bound &&
    (bound.coverage.nativeLang !== course.nativeLang ||
      bound.coverage.targetLang !== course.targetLang)
  )
    throw new LearningMapError('Pinned coverage does not match the course.', 409);
  const catalog: LearningCatalog | null =
    bound?.catalog ?? (available.status === 'PUBLISHED' ? available.catalog : null);
  let coverage = bound?.coverage ?? null;
  let coverageBlocked = false;
  if (!coverage && catalog) {
    try {
      coverage = await resolveSkillRequirementsInTransaction(database, execution, {
        scope: 'CLASS',
        nativeLang: course.nativeLang,
        targetLang: course.targetLang,
        level: course.currentLevel,
      });
    } catch (error) {
      if (
        execution.signal?.aborted ||
        !(error instanceof Error) ||
        error.name !== 'LearningConfigurationError'
      )
        throw error;
      coverageBlocked = true;
    }
  }
  return {
    course,
    binding,
    catalog,
    coverage,
    coverageBlocked,
    upgradeCatalog,
    catalogHash: catalog ? learningCatalogHash(catalog) : null,
  };
}
export type UpgradeContext = Awaited<ReturnType<typeof upgradeContext>>;
export function upgradePreview(context: UpgradeContext) {
  const available = context.upgradeCatalog;
  const old =
    context.catalog?.nodes.filter(
      (node): node is LearningObjective =>
        node.kind === 'OBJECTIVE' && node.required && node.level === context.course.currentLevel
    ) ?? [];
  const next =
    available?.nodes.filter(
      (node): node is LearningObjective =>
        node.kind === 'OBJECTIVE' && node.required && node.level === context.course.currentLevel
    ) ?? [];
  const oldById = new Map(old.map((node) => [node.id, node]));
  const nextById = new Map(next.map((node) => [node.id, node]));
  const targetHash = available ? learningCatalogHash(available) : null;
  const meaning = (node: LearningObjective) =>
    upgradeDigest({
      criterionVersion: node.criterionVersion,
      policyVersion: node.policyVersion,
      level: node.level,
      skills: node.skills,
      skillCriteria: node.skillCriteria,
      assessment: node.assessment,
    });
  return {
    available: Boolean(context.binding && targetHash !== context.catalogHash && available),
    targetHash,
    added: next.filter((node) => !oldById.has(node.id)).length,
    removed: old.filter((node) => !nextById.has(node.id)).length,
    changed: next.filter(
      (node) => oldById.has(node.id) && meaning(oldById.get(node.id)!) !== meaning(node)
    ).length,
    earnedTransitionsPreserved: true as const,
  };
}
export function courseUpgradeIdentity(context: UpgradeContext) {
  const { course } = context;
  return {
    id: course.id,
    owner: course.userId,
    userGeneration: course.user.createdAt.toISOString(),
    courseGeneration: course.createdAt.toISOString(),
    nativeLang: course.nativeLang,
    targetLang: course.targetLang,
    level: course.currentLevel,
    startLevel: course.startLevel,
    placementSource: course.placementSource,
    curriculumId: course.curriculumId,
    catalogHash: context.catalogHash,
    coverage: context.coverage,
  };
}
export function bindUpgradeCursor(
  context: UpgradeContext,
  cursor: LearningUpgradeCursor | null
): LearningUpgradeCursor {
  const identityDigest = upgradeDigest(courseUpgradeIdentity(context));
  if (cursor && cursor.identityDigest !== identityDigest)
    throw new LearningMapError(
      'The course, catalog or coverage changed during maintenance. Start a fresh preview.',
      409
    );
  return (
    cursor ?? {
      schemaVersion: 1,
      stage: 'COURSE',
      afterId: null,
      cutoff: new Date().toISOString(),
      limit: 25,
      identityDigest,
    }
  );
}
export const upgradeCourseId = z.string().min(1).max(200);
