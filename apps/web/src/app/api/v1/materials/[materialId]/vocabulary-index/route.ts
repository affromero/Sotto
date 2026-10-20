import { NextRequest, NextResponse } from 'next/server';
import { vocabularyWorkRequestSchema } from '@sotto/shared';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { requestMaterialVocabularyIndex } from '@/lib/vocabulary/index-admission';
import { vocabularyErrorResponse } from '@/lib/vocabulary/http';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ materialId: string }> }
) {
  const actor = await authenticateRequest(request);
  if (!actor) return errorResponse('Unauthorized', 401);
  try {
    const { retry } = vocabularyWorkRequestSchema.parse(await request.json().catch(() => null));
    return NextResponse.json(
      await requestMaterialVocabularyIndex(
        (await params).materialId,
        sottoRequestExecution(request, actor),
        retry
      ),
      { status: 202 }
    );
  } catch (error) {
    return vocabularyErrorResponse(error);
  }
}
