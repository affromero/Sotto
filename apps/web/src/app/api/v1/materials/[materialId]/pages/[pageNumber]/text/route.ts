import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { materialTextOriginSchema, materialPageTextManifestSchema } from '@sotto/shared';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { decodeMaterialTextChunk } from '@/lib/course-materials/extraction/readers';

const querySchema = z.object({
  materialId: z.uuid(),
  pageNumber: z.coerce.number().int().positive().max(10000),
  runId: z.uuid(),
  origin: materialTextOriginSchema,
  afterIndex: z.coerce.number().int().min(-1).max(8192),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ materialId: string; pageNumber: string }> }
) {
  const admission = await authenticateRequest(request);
  if (!admission) return errorResponse('Unauthorized', 401);
  const parsed = querySchema.safeParse({
    ...(await params),
    runId: request.nextUrl.searchParams.get('runId'),
    origin: request.nextUrl.searchParams.get('origin') ?? 'EMBEDDED_TEXT',
    afterIndex: request.nextUrl.searchParams.get('afterIndex') ?? -1,
  });
  if (!parsed.success) return errorResponse('Invalid material page source request.', 400);
  const input = parsed.data;
  const result = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      await requireOriginalSottoAdmission(database, request, admission);
      const stream = await database.materialPageText.findFirst({
        where: {
          origin: input.origin,
          page: {
            pageNumber: input.pageNumber,
            run: {
              id: input.runId,
              materialId: input.materialId,
              material: { userId: admission.userId, originalUrl: { not: null } },
            },
          },
        },
        include: {
          chunks: {
            where: { index: { gt: input.afterIndex } },
            orderBy: { index: 'asc' },
            take: 9,
          },
        },
      });
      if (!stream) return null;
      const chunks = stream.chunks.slice(0, 8).map((chunk) => ({
        index: chunk.index,
        codePointStart: chunk.codePointStart,
        codePointEnd: chunk.codePointEnd,
        utf8ByteStart: chunk.utf8ByteStart,
        utf8ByteEnd: chunk.utf8ByteEnd,
        sha256: chunk.sha256,
        text: decodeMaterialTextChunk(chunk),
      }));
      return {
        runId: input.runId,
        manifest: materialPageTextManifestSchema.parse(stream.manifest),
        chunks,
        nextIndex: stream.chunks.length > 8 ? chunks.at(-1)!.index : null,
      };
    },
    { signal: request.signal }
  );
  return result
    ? NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
    : errorResponse('Material page text not found', 404);
}
