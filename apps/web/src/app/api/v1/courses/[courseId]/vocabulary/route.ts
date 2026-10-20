import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { readDictionary } from '@/lib/vocabulary/dictionary';
import { vocabularyErrorResponse } from '@/lib/vocabulary/http';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);
  try {
    return NextResponse.json(
      await readDictionary(
        (await params).courseId,
        authed.userId,
        Object.fromEntries(request.nextUrl.searchParams)
      )
    );
  } catch (error) {
    return vocabularyErrorResponse(error);
  }
}
