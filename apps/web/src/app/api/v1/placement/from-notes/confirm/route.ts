import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { createOrRaiseCourse } from '@/lib/placement-course';
import { getCachedNotesDeduction, clearNotesDeduction } from '@/lib/placement-notes';
import { getCourseNote, mergeCourseNote, setCourseNote } from '@/lib/course-notes';
import { extractAndStoreNoteVocab } from '@/lib/live-vocab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const langCode = z.string().trim().toLowerCase().length(2);
const schema = z.object({ native: langCode, target: langCode });

/**
 * POST /api/v1/placement/from-notes/confirm — accept the deduced level ("start
 * here"). Creates (or safely raises) the course at the deduced level, stores the
 * uploaded materials as the course note, and seeds the vocabulary graph. Reads
 * the cached deduction from /from-notes; 409 if it has expired.
 */
export async function POST(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const userId = authed.userId;

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return errorResponse(parsed.error.issues[0].message, 400);
    const { native, target } = parsed.data;
    if (native === target) return errorResponse('native and target must differ', 400);

    const cached = await getCachedNotesDeduction(userId, native, target);
    if (!cached) return errorResponse('Deduction expired. Upload your materials again.', 409);

    const course = await createOrRaiseCourse(userId, native, target, cached.level, 'NOTES');

    // Personalize from day one: keep the materials as the course note and seed
    // the memory graph with vocabulary extracted from them.
    const merged = mergeCourseNote(await getCourseNote(course.id), cached.content);
    await setCourseNote(course.id, merged);
    const addedVocabulary = await extractAndStoreNoteVocab({
      userId,
      courseId: course.id,
      nativeLang: native,
      targetLang: target,
      level: course.currentLevel,
      note: merged,
    });

    await clearNotesDeduction(userId, native, target);
    return NextResponse.json(
      { courseId: course.id, level: course.currentLevel, addedVocabulary },
      { status: 201 },
    );
  } catch (error: unknown) {
    logger.error('Notes-placement confirm failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to confirm placement', 500);
  }
}
