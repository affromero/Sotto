import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { materialUploadCompletionRequestSchema } from '@sotto/shared';
import { completeMaterialUpload } from '@/lib/course-materials/uploads/completion';
import { materialUploadOperation, readUploadJson } from '@/lib/course-materials/uploads/http';

export const runtime = 'nodejs';
export function POST(request: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  return materialUploadOperation(request, async (admission) => {
    const { uploadId } = z.object({ uploadId: z.uuid() }).parse(await params);
    const input = materialUploadCompletionRequestSchema.parse(await readUploadJson(request));
    const upload = await completeMaterialUpload(request, admission, uploadId, input);
    return NextResponse.json(upload, { status: upload.status === 'COMPLETE' ? 200 : 202 });
  });
}
