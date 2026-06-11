import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { liveTranslateSessionSchema } from '@/lib/validations';
import { extractAndStoreLiveVocab } from '@/lib/live-vocab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/live-translate/session — record a finished live conversation. Extracts
 * the new target-language vocabulary from the transcript and adds it to the course
 * memory graph, closing the loop with spaced-repetition review. Best-effort: the
 * extractor never throws, so a vocab-extraction hiccup never fails the response.
 */
export async function POST(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);

  const parsed = liveTranslateSessionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);
  const { courseId, transcript } = parsed.data;

  const course = await prisma.course.findFirst({
    where: { id: courseId, userId: authed.userId },
    select: { nativeLang: true, targetLang: true, currentLevel: true },
  });
  if (!course) return errorResponse('Course not found', 404);

  const added = await extractAndStoreLiveVocab({
    userId: authed.userId,
    courseId,
    targetLang: course.targetLang,
    nativeLang: course.nativeLang,
    level: course.currentLevel,
    transcript,
  });

  return NextResponse.json({ added });
}
