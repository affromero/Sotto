import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { materialUploadPartHeaders, materialUploadPartMetadataSchema } from '@sotto/shared';
import { storeMaterialUploadPart } from '@/lib/course-materials/uploads/parts';
import { materialUploadOperation } from '@/lib/course-materials/uploads/http';

export const runtime = 'nodejs';
const decimal = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform(Number)
  .pipe(z.number().int().nonnegative());
export function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ uploadId: string; index: string }> }
) {
  return materialUploadOperation(request, async (admission) => {
    const { uploadId, index } = z
      .object({ uploadId: z.uuid(), index: decimal })
      .parse(await params);
    const metadata = materialUploadPartMetadataSchema.parse({
      schemaVersion: 1,
      index,
      offset: decimal.parse(request.headers.get(materialUploadPartHeaders.offset)),
      byteSize: decimal.parse(request.headers.get(materialUploadPartHeaders.byteSize)),
      sha256: request.headers.get(materialUploadPartHeaders.sha256),
    });
    return NextResponse.json(await storeMaterialUploadPart(request, admission, uploadId, metadata));
  });
}
