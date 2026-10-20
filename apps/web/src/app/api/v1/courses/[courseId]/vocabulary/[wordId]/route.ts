import { NextRequest, NextResponse } from 'next/server';
import { dictionaryMeaningSchema } from '@sotto/shared';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { vocabularyErrorResponse } from '@/lib/vocabulary/http';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string; wordId: string }> }
) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);
  try {
    const { courseId, wordId } = await params;
    const data = dictionaryMeaningSchema.parse(await request.json().catch(() => null));
    const changed = await prisma.learnerVocab.updateMany({
      where: { id: wordId, courseId, course: { userId: authed.userId } },
      data: { ...data, acceptedMeanings: [...new Set(data.acceptedMeanings)] },
    });
    return changed.count === 1
      ? NextResponse.json({ saved: true })
      : errorResponse('Word not found.', 404);
  } catch (error) {
    return vocabularyErrorResponse(error);
  }
}
