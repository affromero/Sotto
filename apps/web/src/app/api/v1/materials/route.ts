import { NextRequest, NextResponse } from 'next/server';
import { RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { isAccessError } from 'thesidedoor-core/access';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { importCourseMaterials, readMaterialForm } from '@/lib/course-materials';

export const runtime = 'nodejs';

export function POST(request: NextRequest) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    const admission = await authenticateRequest(request);
    if (!admission) return errorResponse('Unauthorized', 401);
    try {
      const { files } = await readMaterialForm(request);
      if (!files.length) return errorResponse('No materials uploaded', 400);
      const result = await importCourseMaterials(request, admission, files);
      if (!result.materials.length) return errorResponse('No readable materials uploaded', 422);
      return NextResponse.json(result, { status: 201 });
    } catch (error) {
      if (isAccessError(error)) throw error;
      if (error instanceof RequestBodyTooLargeError)
        return errorResponse('Materials must total 50MB or less.', 413);
      return errorResponse('Could not retain the uploaded materials.', 500);
    }
  });
}
