import type { Prisma } from '@/generated/prisma/client';
import type { StorageDeletionScope } from '@/lib/storage/sidedoor/deletion-targets';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { retirePracticeSourceSnapshots } from '@/lib/practice/source-retirement';

function analysisWhere(
  scope: Exclude<StorageDeletionScope, { kind: 'material-upload' }>
): Prisma.MaterialAnalysisWhereInput {
  return scope.kind === 'instance'
    ? {}
    : scope.kind === 'profile'
      ? { userId: scope.id }
      : scope.kind === 'material'
        ? { sources: { some: { materialId: scope.id } } }
        : {
            OR: [
              { intendedCourseId: scope.id },
              { attachedCourseId: scope.id },
              { sources: { some: { material: { courseId: scope.id } } } },
            ],
          };
}

/** Queued work retains these immutable entity scopes even after course attachment. */
export async function materialAnalysisDeletionSubjects(
  database: Prisma.TransactionClient,
  scope: StorageDeletionScope
) {
  if (scope.kind === 'material-upload') return [];
  const analysis = analysisWhere(scope);
  const subjects: Array<{ subjectId: string; generation: number }> = [];
  let cursor: string | null = null;
  while (true) {
    const rows: Array<{ id: string; createdAt: Date }> = await database.materialAnalysis.findMany({
      where: { ...analysis, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, createdAt: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    for (const row of rows)
      subjects.push({
        subjectId: `material-analysis:${row.id}`,
        generation: row.createdAt.getTime(),
      });
    if (rows.length < 100) break;
    cursor = rows[rows.length - 1].id;
  }
  const session: Prisma.PlacementSessionWhereInput =
    scope.kind === 'instance' ? {} : scope.kind === 'profile' ? { userId: scope.id } : { analysis };
  cursor = null;
  while (true) {
    const rows: Array<{ id: string; createdAt: Date }> = await database.placementSession.findMany({
      where: { ...session, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, createdAt: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    for (const row of rows)
      subjects.push({
        subjectId: `placement-session:${row.id}`,
        generation: row.createdAt.getTime(),
      });
    if (rows.length < 100) break;
    cursor = rows[rows.length - 1].id;
  }
  return subjects;
}

/** Exact paid grants retire before the containing private aggregates cascade. */
export async function eraseMaterialAnalysisState(
  database: Prisma.TransactionClient,
  scope: StorageDeletionScope
) {
  if (scope.kind === 'material-upload') return;
  const analysis = analysisWhere(scope);
  let after: string | null = null;
  while (true) {
    const rows: Array<{ id: string }> = await database.materialAnalysis.findMany({
      where: { ...analysis, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' },
      take: 100,
      select: { id: true },
    });
    await retirePracticeSourceSnapshots(
      database,
      rows.map((row) => row.id)
    );
    if (rows.length < 100) break;
    after = rows[rows.length - 1]!.id;
  }
  after = null;
  while (true) {
    const rows: Array<{ id: string }> = await database.materialAnalysisUnit.findMany({
      where: {
        ...(after ? { id: { gt: after } } : {}),
        analysis,
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    if (!rows.length) break;
    await database.sidedoorState.deleteMany({
      where: {
        id: { in: rows.map((row) => `${SIDEDOOR_STATE_ID}:material-analysis-grant:${row.id}`) },
      },
    });
    if (rows.length < 100) break;
    after = rows[rows.length - 1]!.id;
  }
  const session: Prisma.PlacementSessionWhereInput =
    scope.kind === 'instance' ? {} : scope.kind === 'profile' ? { userId: scope.id } : { analysis };
  after = null;
  while (true) {
    const rows: Array<{ id: string }> = await database.placementSession.findMany({
      where: {
        ...session,
        ...(after ? { id: { gt: after } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    if (!rows.length) break;
    await database.sidedoorState.deleteMany({
      where: {
        id: { in: rows.map((row) => `${SIDEDOOR_STATE_ID}:placement-session-grant:${row.id}`) },
      },
    });
    if (rows.length < 100) break;
    after = rows[rows.length - 1]!.id;
  }
  // A multi-source result contains every selected source. Deleting one original
  // retires the whole derived result while preserving unrelated originals.
  await database.materialAnalysis.deleteMany({ where: analysis });
  if (scope.kind === 'instance' || scope.kind === 'profile')
    await database.placementSession.deleteMany({ where: session });
}
