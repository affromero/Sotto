import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { readOwnedUpload, uploadResponse } from '@/lib/course-materials/uploads/state';
import { cancelMaterialUpload } from '@/lib/course-materials/uploads/cleanup';
import { materialUploadOperation } from '@/lib/course-materials/uploads/http';

export const runtime = 'nodejs';
type Context = { params: Promise<{ uploadId: string }> };
export function GET(request: NextRequest, { params }: Context) {
  return materialUploadOperation(request, async (admission) => {
    const { uploadId } = z.object({ uploadId: z.uuid() }).parse(await params);
    const state = await sottoTransaction(
      prisma,
      async (database) => {
        await requireOriginalSottoAdmission(database, request, admission);
        return uploadResponse(await readOwnedUpload(database, admission.userId, uploadId));
      },
      { signal: request.signal }
    );
    return NextResponse.json(state, { headers: { 'Cache-Control': 'private, no-store' } });
  });
}
export function DELETE(request: NextRequest, { params }: Context) {
  return materialUploadOperation(request, async (admission) => {
    const { uploadId } = z.object({ uploadId: z.uuid() }).parse(await params);
    return NextResponse.json(await cancelMaterialUpload(request, admission, uploadId));
  });
}
