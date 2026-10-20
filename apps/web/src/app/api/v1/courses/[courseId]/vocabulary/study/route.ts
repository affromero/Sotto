import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { startVocabularyStudy } from '@/lib/vocabulary/study-admission';
import { vocabularyErrorResponse } from '@/lib/vocabulary/http';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);
  try {
    return NextResponse.json(
      await startVocabularyStudy(
        (await params).courseId,
        sottoRequestExecution(request, authed),
        await request.json().catch(() => null)
      )
    );
  } catch (error) {
    return vocabularyErrorResponse(error);
  }
}
