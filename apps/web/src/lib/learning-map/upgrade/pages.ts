import { z } from 'zod';
import type { LearningUpgradeCursor, LearningUpgradeItem } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { mapLessonToCatalog } from '@/lib/learning-map/lessons';
import { encodeUpgradeCursor, upgradeDigest, type UpgradeContext } from './context';

const stages = ['COURSE', 'LESSONS', 'GRAMMAR', 'MATERIALS'] as const;
function next(cursor: LearningUpgradeCursor, more: boolean, lastId?: string) {
  const stage = more ? cursor.stage : stages[stages.indexOf(cursor.stage) + 1];
  return stage ? encodeUpgradeCursor({ ...cursor, stage, afterId: more ? lastId! : null }) : null;
}
const item = (
  value: Pick<LearningUpgradeItem, 'kind' | 'id' | 'sourceDigest' | 'level' | 'disposition'>
): LearningUpgradeItem => ({
  ...value,
  objectiveIds: [],
  unresolvedKeys: [],
  existingLinks: 0,
  missingLinks: 0,
  notes: [],
});
export async function readUpgradePage(
  database: Prisma.TransactionClient,
  context: UpgradeContext,
  cursor: LearningUpgradeCursor,
  lock: boolean
) {
  const cutoff = new Date(cursor.cutoff);
  const rowsAfter = cursor.afterId ? { id: { gt: cursor.afterId } } : {};
  const items: LearningUpgradeItem[] = [];
  const links: Array<{
    lessonId: string;
    objectiveId: string;
    criterionVersion: number;
    role: string;
  }> = [];
  let nextCursor: string | null;
  if (cursor.stage === 'COURSE') {
    items.push(
      item({
        kind: 'COURSE',
        id: context.course.id,
        level: context.course.currentLevel,
        sourceDigest: upgradeDigest({
          catalogHash: context.catalogHash,
          coverage: context.coverage,
        }),
        disposition: context.binding
          ? 'PINNED'
          : !context.catalog
            ? 'CATALOG_UNAVAILABLE'
            : context.coverageBlocked
              ? 'CONFIGURATION_BLOCKED'
              : 'WOULD_BIND',
      })
    );
    nextCursor = next(cursor, false);
  } else if (cursor.stage === 'LESSONS') {
    const selected = await database.lesson.findMany({
      where: {
        curriculumId: context.course.curriculumId,
        createdAt: { lte: cutoff },
        ...rowsAfter,
      },
      orderBy: { id: 'asc' },
      take: cursor.limit + 1,
      select: { id: true },
    });
    const ids = selected.slice(0, cursor.limit).map((row) => row.id);
    if (lock)
      for (const id of ids)
        await database.$queryRaw`SELECT id FROM "Lesson" WHERE id=${id} AND "curriculumId"=${context.course.curriculumId} FOR UPDATE`;
    const lessons = await database.lesson.findMany({
      where: { id: { in: ids }, curriculumId: context.course.curriculumId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        level: true,
        slug: true,
        grammarPoints: true,
        updatedAt: true,
        learningObjectives: true,
      },
    });
    for (const lesson of lessons) {
      const grammar = z.array(z.string()).safeParse(lesson.grammarPoints);
      const sourceDigest = upgradeDigest({
        id: lesson.id,
        curriculumId: context.course.curriculumId,
        level: lesson.level,
        slug: lesson.slug,
        grammarPoints: lesson.grammarPoints,
        updatedAt: lesson.updatedAt.toISOString(),
      });
      const mapping =
        context.catalog && grammar.success
          ? mapLessonToCatalog(context.catalog, {
              level: lesson.level,
              grammarPoints: grammar.data,
            })
          : null;
      const missing =
        mapping?.objectives.filter(
          (objective) =>
            !lesson.learningObjectives.some(
              (existing) => existing.objectiveId === objective.objectiveId
            )
        ) ?? [];
      links.push(...missing.map((objective) => ({ lessonId: lesson.id, ...objective })));
      const current = item({
        kind: 'LESSON',
        id: lesson.id,
        sourceDigest,
        level: lesson.level,
        disposition: !context.catalog
          ? 'CATALOG_UNAVAILABLE'
          : !mapping || mapping.unresolved
            ? 'MAPPING_UNRESOLVED'
            : 'MAPPED',
      });
      current.existingLinks = lesson.learningObjectives.length;
      current.missingLinks = missing.length;
      current.objectiveIds = (
        mapping?.objectives.map((objective) => objective.objectiveId) ?? []
      ).slice(0, 200);
      current.unresolvedKeys = (
        mapping?.unresolvedGrammarKeys ?? (grammar.success ? grammar.data : [])
      ).slice(0, 200);
      if (!grammar.success) current.notes.push('Invalid legacy grammar data remains unresolved.');
      if ((mapping?.unresolvedGrammarKeys.length ?? 0) > 200)
        current.notes.push('Unresolved key preview is limited to 200 entries.');
      if (lesson.learningObjectives.length)
        current.notes.push(
          'Every existing explicit or legacy objective link is preserved, including its criterion and role.'
        );
      items.push(current);
    }
    nextCursor = next(cursor, selected.length > cursor.limit, ids.at(-1));
  } else if (cursor.stage === 'GRAMMAR') {
    const selected = await database.learnerGrammar.findMany({
      where: { courseId: context.course.id, createdAt: { lte: cutoff }, ...rowsAfter },
      orderBy: { id: 'asc' },
      take: cursor.limit + 1,
    });
    const rows = selected.slice(0, cursor.limit);
    for (const grammar of rows) {
      const mapping =
        context.catalog && grammar.cefrLevel
          ? mapLessonToCatalog(context.catalog, {
              level: grammar.cefrLevel,
              grammarPoints: [grammar.topicKey],
            })
          : null;
      const current = item({
        kind: 'LEGACY_GRAMMAR',
        id: grammar.id,
        level: grammar.cefrLevel,
        sourceDigest: upgradeDigest({
          id: grammar.id,
          key: grammar.topicKey,
          level: grammar.cefrLevel,
          updatedAt: grammar.updatedAt.toISOString(),
        }),
        disposition: context.catalog ? 'BROAD_LEGACY' : 'CATALOG_UNAVAILABLE',
      });
      current.objectiveIds = mapping?.objectives.map((objective) => objective.objectiveId) ?? [];
      current.unresolvedKeys = mapping?.objectives.length ? [] : [grammar.topicKey];
      current.notes.push(
        'Aggregate grammar quality has no item-level assessment provenance. No canonical observation, lower-band mastery or SRS state is reconstructed.'
      );
      if (!grammar.cefrLevel)
        current.notes.push(
          'The saved grammar band is unknown. Its alias cannot establish an assessment criterion.'
        );
      items.push(current);
    }
    nextCursor = next(cursor, selected.length > cursor.limit, rows.at(-1)?.id);
  } else {
    const selected = await database.courseMaterial.findMany({
      where: {
        courseId: context.course.id,
        userId: context.course.userId,
        createdAt: { lte: cutoff },
        ...rowsAfter,
      },
      orderBy: { id: 'asc' },
      take: cursor.limit + 1,
      select: {
        id: true,
        createdAt: true,
        originalUrl: true,
        originalSha256: true,
        processingRevision: true,
        processingStatus: true,
        extractionRuns: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, processingRevision: true, originalSha256: true, status: true },
        },
      },
    });
    const rows = selected.slice(0, cursor.limit);
    for (const material of rows) {
      const run = material.extractionRuns[0];
      const source = run
        ? await database.materialAnalysisSource.findFirst({
            where: {
              materialId: material.id,
              runId: run.id,
              processingRevision: material.processingRevision,
              originalSha256: material.originalSha256,
              analysis: {
                userId: context.course.userId,
                OR: [
                  { attachedCourseId: context.course.id },
                  { intendedCourseId: context.course.id },
                ],
              },
            },
            orderBy: { analysis: { createdAt: 'desc' } },
            select: { analysis: { select: { id: true, status: true, resultDigest: true } } },
          })
        : null;
      const status = source?.analysis.status;
      let disposition: LearningUpgradeItem['disposition'] = 'ANALYSIS_REQUIRED';
      if (!material.originalUrl) disposition = 'ORIGINAL_UNAVAILABLE';
      else if (!material.originalSha256) disposition = 'ORIGINAL_VERIFICATION_REQUIRED';
      else if (
        !run ||
        run.processingRevision !== material.processingRevision ||
        run.originalSha256 !== material.originalSha256
      )
        disposition = 'EXTRACTION_REQUIRED';
      else if (['PENDING', 'EXTRACTING'].includes(run.status)) disposition = 'EXTRACTION_PENDING';
      else if (
        ['FAILED', 'RECOVERY_REQUIRED'].includes(run.status) ||
        ['RECOVERY_REQUIRED', 'CANCELLING'].includes(status ?? '')
      )
        disposition = 'RECOVERY_REQUIRED';
      else if (['WAITING_SOURCE', 'RUNNING'].includes(status ?? ''))
        disposition = 'ANALYSIS_PENDING';
      else if (status === 'COMPLETE') disposition = 'ANALYSIS_READY';
      else if (['PARTIAL', 'INSUFFICIENT_SOURCE'].includes(status ?? ''))
        disposition = 'ANALYSIS_PARTIAL';
      const current = item({
        kind: 'MATERIAL',
        id: material.id,
        level: null,
        sourceDigest: upgradeDigest({
          id: material.id,
          generation: material.createdAt.toISOString(),
          originalUrl: material.originalUrl,
          originalSha256: material.originalSha256,
          processingRevision: material.processingRevision,
          run: run ?? null,
          analysis: source?.analysis ?? null,
        }),
        disposition,
      });
      current.notes.push(
        'Original bytes and extracts are unchanged. Extraction, OCR and source analysis require their existing explicit owned admission flows.'
      );
      items.push(current);
    }
    nextCursor = next(cursor, selected.length > cursor.limit, rows.at(-1)?.id);
  }
  return { items, links, nextCursor };
}
