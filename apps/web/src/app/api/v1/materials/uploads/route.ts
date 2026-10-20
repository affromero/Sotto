import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { materialUploadCapabilities, materialUploadBatchRequestSchema } from '@sotto/shared';
import { createMaterialUploadBatch } from '@/lib/course-materials/uploads/admission';
import { materialUploadOperation, readUploadJson } from '@/lib/course-materials/uploads/http';

export const runtime = 'nodejs';
export function GET(request: NextRequest) {
  return materialUploadOperation(request, async () =>
    NextResponse.json(materialUploadCapabilities, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  );
}
export function POST(request: NextRequest) {
  return materialUploadOperation(request, async (admission) => {
    const input = materialUploadBatchRequestSchema.parse(await readUploadJson(request));
    const courseId = z
      .string()
      .min(1)
      .max(100)
      .optional()
      .parse(request.nextUrl.searchParams.get('courseId') ?? undefined);
    return NextResponse.json(await createMaterialUploadBatch(request, admission, input, courseId), {
      status: 201,
    });
  });
}
