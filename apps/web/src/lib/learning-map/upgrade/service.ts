import {
  applyLearningUpgradeRequestSchema,
  learningUpgradeReportSchema,
  learningUpgradeCoursesSchema,
} from '@sotto/shared';
import { prismaUnfiltered } from '@/lib/prisma';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { ensureLearningLevelBinding } from '@/lib/learning-map/binding';
import { publishLearningCatalog } from '@/lib/learning-map/catalog';
import { LearningMapError } from '@/lib/learning-map/read';
import {
  upgradeContext,
  decodeUpgradeCursor,
  upgradeDigest,
  courseUpgradeIdentity,
  upgradePreview,
  bindUpgradeCursor,
  type UpgradeContext,
} from './context';
import { readUpgradePage } from './pages';

function report(
  context: UpgradeContext,
  cursor: ReturnType<typeof decodeUpgradeCursor>,
  page: Awaited<ReturnType<typeof readUpgradePage>>,
  mode: 'DRY_RUN' | 'APPLY',
  changed = { bindings: 0, lessonLinks: 0 }
) {
  return learningUpgradeReportSchema.parse({
    schemaVersion: 1,
    courseId: context.course.id,
    courseGeneration: context.course.createdAt.toISOString(),
    level: context.course.currentLevel,
    startLevel: context.course.startLevel,
    placementSource: context.course.placementSource,
    mode,
    cursor,
    nextCursor: page.nextCursor,
    pageDigest: upgradeDigest({
      course: courseUpgradeIdentity(context),
      cursor,
      sources: page.items.map((item) => ({
        kind: item.kind,
        id: item.id,
        sourceDigest: item.sourceDigest,
      })),
    }),
    catalog: {
      available: context.catalog !== null,
      hash: context.catalogHash,
      version: context.catalog?.version ?? null,
      pinned: context.binding !== null,
    },
    coverage: context.coverage,
    upgrade: upgradePreview(context),
    items: page.items,
    changed,
    evidence: 'LEGACY_EVIDENCE_REMAINS_BROAD',
  });
}
export async function previewLearningUpgrade(
  execution: SottoProviderExecution,
  courseId: string,
  cursorValue: string | null
) {
  const selected = cursorValue === null ? null : decodeUpgradeCursor(cursorValue);
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const context = await upgradeContext(database, execution, courseId, false);
      const cursor = bindUpgradeCursor(context, selected);
      return report(
        context,
        cursor,
        await readUpgradePage(database, context, cursor, false),
        'DRY_RUN'
      );
    },
    { signal: execution.signal, timeoutMs: 60000 }
  );
}
/** Existing unique pins and links make response-loss replay idempotent without a maintenance journal. */
export async function applyLearningUpgrade(
  execution: SottoProviderExecution,
  courseId: string,
  value: unknown
) {
  const input = applyLearningUpgradeRequestSchema.parse(value);
  const cursor = decodeUpgradeCursor(input.cursor);
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const context = await upgradeContext(database, execution, courseId, true);
      bindUpgradeCursor(context, cursor);
      const page = await readUpgradePage(database, context, cursor, true);
      const preview = report(context, cursor, page, 'DRY_RUN');
      if (
        context.course.currentLevel !== input.expectedLevel ||
        context.catalogHash !== input.expectedCatalogHash ||
        preview.pageDigest !== input.expectedPageDigest
      )
        throw new LearningMapError(
          'The course, catalog, coverage or source page changed. Preview this exact page again.',
          409
        );
      const changed = { bindings: 0, lessonLinks: 0 };
      if (cursor.stage === 'COURSE' && !context.binding && context.catalog && context.coverage) {
        await ensureLearningLevelBinding(
          database,
          context.course,
          context.course.currentLevel,
          context.coverage
        );
        changed.bindings = 1;
      }
      if (cursor.stage === 'LESSONS' && context.catalog && page.links.length) {
        await publishLearningCatalog(database, context.catalog);
        changed.lessonLinks = (
          await database.lessonLearningObjective.createMany({
            data: page.links,
            skipDuplicates: true,
          })
        ).count;
      }
      const current = await upgradeContext(database, execution, courseId, false);
      return report(
        current,
        cursor,
        await readUpgradePage(database, current, cursor, false),
        'APPLY',
        changed
      );
    },
    { signal: execution.signal, timeoutMs: 60000 }
  );
}
export async function listLearningUpgradeCourses(
  execution: SottoProviderExecution,
  afterId: string | null
) {
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== execution.userId)
        throw new LearningMapError('The upgrade recipient changed.', 409);
      const rows = await database.course.findMany({
        where: { userId: actor.userId, ...(afterId ? { id: { gt: afterId } } : {}) },
        orderBy: { id: 'asc' },
        take: 21,
        select: { id: true, nativeLang: true, targetLang: true, currentLevel: true },
      });
      const page = rows.slice(0, 20);
      return learningUpgradeCoursesSchema.parse({
        courses: page.map((row) => ({
          id: row.id,
          nativeLang: row.nativeLang,
          targetLang: row.targetLang,
          level: row.currentLevel,
        })),
        nextAfterId: rows.length > 20 ? page.at(-1)!.id : null,
      });
    },
    { signal: execution.signal }
  );
}
