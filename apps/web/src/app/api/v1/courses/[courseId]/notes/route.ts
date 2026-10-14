import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import {
  MAX_NOTE_LENGTH,
  getCourseNote,
  getEditableCourseNote,
  normalizeCourseNote,
  setCourseNote,
} from '@/lib/course-notes';
import { extractAndStoreNoteVocab } from '@/lib/live-vocab';
import {
  sottoRequestExecution,
  type SottoProviderExecution,
} from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  importCourseMaterials,
  materialSelect,
  materialResponse,
  readMaterialForm,
} from '@/lib/course-materials';
import { RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { isAccessError } from 'thesidedoor-core/access';

type RouteParams = { params: Promise<{ courseId: string }> };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noteSchema = z.object({ body: z.string().max(MAX_NOTE_LENGTH) });

interface OwnedCourseContext {
  nativeLang: string;
  targetLang: string;
  currentLevel: string;
}

async function getOwnedCourse(
  courseId: string,
  userId: string
): Promise<OwnedCourseContext | null> {
  return prisma.course.findFirst({
    where: { id: courseId, userId },
    select: { nativeLang: true, targetLang: true, currentLevel: true },
  });
}

async function updateVocabularyFromNote(
  userId: string,
  courseId: string,
  course: OwnedCourseContext,
  body: string,
  execution: SottoProviderExecution
): Promise<number> {
  return extractAndStoreNoteVocab({
    userId,
    execution,
    courseId,
    targetLang: course.targetLang,
    nativeLang: course.nativeLang,
    level: course.currentLevel,
    note: body,
  });
}

/** GET /api/courses/[courseId]/notes — the learner's free-text context note. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { courseId } = await params;
    if (!(await getOwnedCourse(courseId, authed.userId))) {
      return errorResponse('Course not found', 404);
    }

    const body = await getEditableCourseNote(courseId);
    const materials = await prisma.courseMaterial.findMany({
      where: { courseId, userId: authed.userId, originalUrl: { not: null } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: materialSelect,
    });
    return NextResponse.json(
      { body, materials: materials.map(materialResponse) },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error: unknown) {
    logger.error('Failed to load course note', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to load course note', 500);
  }
}

/** PUT /api/courses/[courseId]/notes — replace the note (empty body clears it). */
export function PUT(request: NextRequest, context: RouteParams) {
  return accessOperation(request, !request.headers.has('authorization'), () =>
    saveNotes(request, context)
  );
}

async function saveNotes(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { courseId } = await params;
    const course = await getOwnedCourse(courseId, authed.userId);
    if (!course) return errorResponse('Course not found', 404);

    const parsed = noteSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse('Invalid note body', 400);

    const body = normalizeCourseNote(parsed.data.body);
    await setCourseNote(courseId, body);
    const addedVocabulary = await updateVocabularyFromNote(
      authed.userId,
      courseId,
      course,
      await getCourseNote(courseId),
      sottoRequestExecution(request, authed)
    );
    return NextResponse.json({ body, addedVocabulary });
  } catch (error: unknown) {
    logger.error('Failed to save course note', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to save course note', 500);
  }
}

/** POST /api/courses/[courseId]/notes — import uploaded note files into the note. */
export function POST(request: NextRequest, context: RouteParams) {
  return accessOperation(request, !request.headers.has('authorization'), () =>
    importNotes(request, context)
  );
}

async function importNotes(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { courseId } = await params;
    const course = await getOwnedCourse(courseId, authed.userId);
    if (!course) return errorResponse('Course not found', 404);

    const { files } = await readMaterialForm(request);
    if (files.length === 0) return errorResponse('No note files uploaded', 400);

    const { materials, failed } = await importCourseMaterials(request, authed, files, courseId);
    if (materials.length === 0) return errorResponse('No readable note files uploaded', 422);
    const body = await getEditableCourseNote(courseId);
    const addedVocabulary = await updateVocabularyFromNote(
      authed.userId,
      courseId,
      course,
      await getCourseNote(courseId),
      sottoRequestExecution(request, authed)
    );

    return NextResponse.json({
      body,
      imported: materials.length,
      materials: (
        await prisma.courseMaterial.findMany({
          where: { courseId, userId: authed.userId, originalUrl: { not: null } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: materialSelect,
        })
      ).map(materialResponse),
      failed,
      addedVocabulary,
    });
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError)
      return errorResponse('Materials must total 10MB or less.', 413);
    if (isAccessError(error)) throw error;
    logger.error('Failed to import course notes', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to import course notes', 500);
  }
}
