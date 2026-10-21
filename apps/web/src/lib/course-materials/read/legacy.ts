import { z } from 'zod';
import { legacyMaterialTextSchema } from '@sotto/shared';
import { Prisma } from '@/generated/prisma/client';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { materialSelect, materialResponse } from '@/lib/course-materials';
import { MaterialAnalysisConflict } from '@/lib/course-materials/analysis/inventory';

const cursorSchema = z
  .object({
    courseId: z.string().min(1).max(200),
    createdAt: z.iso.datetime(),
    id: z.string().min(1).max(200),
  })
  .strict();
function decode(cursor: string | null, courseId: string) {
  if (cursor === null) return null;
  try {
    if (cursor.length > 2000) throw new Error('Cursor limit');
    const saved = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    if (saved.courseId !== courseId) throw new Error('Other course');
    return saved;
  } catch {
    throw new MaterialAnalysisConflict('The material cursor does not match this course.', 400);
  }
}
async function recipient(database: Prisma.TransactionClient, execution: SottoProviderExecution) {
  const actor = await execution.authorize(database);
  if (actor.userId !== execution.userId)
    throw new MaterialAnalysisConflict('The material recipient changed.');
  return actor.userId;
}
/** Metadata queries never fetch the retained text value. */
export async function readCourseMaterialMetadata(
  database: Prisma.TransactionClient,
  execution: SottoProviderExecution,
  courseId: string,
  cursor: string | null
) {
  const userId = await recipient(database, execution);
  if (!(await database.course.findFirst({ where: { id: courseId, userId }, select: { id: true } })))
    throw new MaterialAnalysisConflict('Course not found.', 404);
  const after = decode(cursor, courseId);
  const rows = await database.courseMaterial.findMany({
    where: {
      courseId,
      userId,
      originalUrl: { not: null },
      ...(after
        ? {
            OR: [
              { createdAt: { gt: new Date(after.createdAt) } },
              { createdAt: new Date(after.createdAt), id: { gt: after.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 21,
    select: materialSelect,
  });
  const page = rows.slice(0, 20);
  const retained = page.length
    ? await database.$queryRaw<Array<{ id: string; textRetained: boolean }>>(
        Prisma.sql`SELECT id, ("extractedText" <> '') AS "textRetained" FROM "CourseMaterial" WHERE "userId"=${userId} AND "courseId"=${courseId} AND id IN (${Prisma.join(page.map((row) => row.id))})`
      )
    : [];
  const byId = new Map(retained.map((row) => [row.id, row.textRetained]));
  const last = page.at(-1);
  return {
    materials: page.map((row) =>
      materialResponse({ ...row, textRetained: byId.get(row.id) ?? false })
    ),
    nextCursor:
      rows.length > 20 && last
        ? Buffer.from(
            JSON.stringify({ courseId, createdAt: last.createdAt.toISOString(), id: last.id })
          ).toString('base64url')
        : null,
  };
}
export const legacyMaterialTextQuerySchema = z
  .object({
    materialId: z.uuid(),
    offset: z.coerce.number().int().min(0).max(2147483646),
    limit: z.coerce.number().int().min(1).max(8192),
  })
  .strict();
/** PostgreSQL counts and slices Unicode codepoints; complete legacy text remains in its original row. */
export async function readLegacyMaterialText(
  database: Prisma.TransactionClient,
  execution: SottoProviderExecution,
  input: z.infer<typeof legacyMaterialTextQuerySchema>
) {
  const userId = await recipient(database, execution);
  const rows = await database.$queryRaw<
    Array<{ id: string; totalCodePoints: number; text: string }>
  >`SELECT id, char_length("extractedText")::int AS "totalCodePoints", substring("extractedText", ${input.offset + 1}::int, ${input.limit}::int) AS text FROM "CourseMaterial" WHERE id=${input.materialId} AND "userId"=${userId}`;
  const row = rows[0];
  if (!row) throw new MaterialAnalysisConflict('Material text not found.', 404);
  if (input.offset > row.totalCodePoints)
    throw new MaterialAnalysisConflict('The text offset exceeds this retained source.', 400);
  const end = input.offset + [...row.text].length;
  return legacyMaterialTextSchema.parse({
    materialId: row.id,
    origin: 'LEGACY_EMBEDDED_TEXT',
    offset: input.offset,
    totalCodePoints: row.totalCodePoints,
    text: row.text,
    nextOffset: end < row.totalCodePoints ? end : null,
  });
}
