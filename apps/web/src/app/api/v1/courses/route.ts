import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { getOrCreateCurriculum } from '@/lib/curriculum-generator';
import { cefrRank } from '@/lib/cefr-levels';

const langCode = z.string().trim().toLowerCase().length(2);
const createSchema = z.object({ native: langCode, target: langCode });

/** GET /api/courses — list the signed-in learner's courses. */
export async function GET(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);

    const courses = await prisma.course.findMany({
      where: { userId: authed.userId },
      select: {
        id: true,
        nativeLang: true,
        targetLang: true,
        currentLevel: true,
        startLevel: true,
        placementSource: true,
        pedagogy: true,
        activeClassId: true,
        curriculum: { select: { title: true } },
        placement: { select: { level: true, createdAt: true } },
        classes: {
          orderBy: [{ createdAt: 'desc' }],
          select: {
            id: true,
            order: true,
            status: true,
            attempt: true,
            sourceTitle: true,
            createdAt: true,
            submittedAt: true,
            passedAt: true,
            failedAt: true,
            lesson: { select: { title: true, level: true } },
            submission: { select: { overallScore: true, passed: true, submittedAt: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const activeIds = courses
      .map((course) => course.activeClassId)
      .filter((id): id is string => Boolean(id));
    const activeClasses =
      activeIds.length > 0
        ? await prisma.courseClass.findMany({
            where: { id: { in: activeIds }, course: { userId: authed.userId } },
            select: {
              id: true,
              lesson: { select: { level: true } },
            },
          })
        : [];
    const activeLevelById = new Map(activeClasses.map((cls) => [cls.id, cls.lesson.level]));
    const sanitizedCourses = courses.map((course) => {
      const activeLevel = course.activeClassId
        ? activeLevelById.get(course.activeClassId)
        : undefined;
      const activeClassId =
        activeLevel && cefrRank(activeLevel) >= cefrRank(course.currentLevel)
          ? course.activeClassId
          : null;
      return { ...course, activeClassId, classes: course.classes ?? [] };
    });

    return NextResponse.json({ courses: sanitizedCourses });
  } catch (error: unknown) {
    logger.error('Failed to list courses', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to list courses', 500);
  }
}

/** POST /api/courses { native, target } — start a course at A1 (skip placement).
 *  Composes the curriculum on demand for any pair we haven't hand-authored. */
export async function POST(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const userId = authed.userId;

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse(parsed.error.issues[0].message, 400);
    const { native, target } = parsed.data;
    if (native === target) return errorResponse('Native and target languages must differ.', 400);

    const existingCourse = await prisma.course.findUnique({
      where: { userId_nativeLang_targetLang: { userId, nativeLang: native, targetLang: target } },
      select: { id: true },
    });
    if (existingCourse) {
      return errorResponse('A course for this language pair already exists.', 409, {
        courseId: existingCourse.id,
      });
    }

    const curriculum = await getOrCreateCurriculum(userId, native, target);

    const course = await prisma.course.create({
      // Skip-placement start: the learner chose A1 without a test -> MANUAL.
      data: {
        userId,
        nativeLang: native,
        targetLang: target,
        curriculumId: curriculum.id,
        placementSource: 'MANUAL',
      },
    });

    return NextResponse.json({ course }, { status: 201 });
  } catch (error: unknown) {
    logger.error('Failed to create course', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to create course', 500);
  }
}
