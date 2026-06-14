import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, cache } from '@/lib/redis';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import {
  generatePlacement,
  scorePlacement,
  toPublic,
  type PlacementQuestion,
} from '@/lib/placement-test';
import { getOrCreateCurriculum } from '@/lib/curriculum-generator';
import { getCourseNote } from '@/lib/course-notes';
import { higherLevel } from '@/lib/cefr-levels';

const langCode = z.string().trim().toLowerCase().length(2);
const submitSchema = z.object({
  native: langCode,
  target: langCode,
  answers: z
    // selectedIndex 0..3 = a content option; 4 = the "I don't know" option.
    .array(z.object({ id: z.string(), selectedIndex: z.number().int().min(0).max(4) }))
    .min(1),
});

const cacheKey = (userId: string, native: string, target: string) =>
  `placement:${userId}:${native}_${target}`;

/** GET /api/placement?native=en&target=de — generate an adaptive placement batch. */
export async function GET(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const userId = authed.userId;

    const nativeParse = langCode.safeParse(request.nextUrl.searchParams.get('native'));
    const targetParse = langCode.safeParse(request.nextUrl.searchParams.get('target'));
    if (!nativeParse.success || !targetParse.success) {
      return errorResponse('Invalid or missing "native"/"target"', 400);
    }
    const native = nativeParse.data;
    const target = targetParse.data;
    if (native === target) return errorResponse('native and target must differ', 400);

    const rate = await checkRateLimit(`placement:${userId}`, 10, 3600);
    if (!rate.allowed) {
      return errorResponse('Rate limit exceeded. Try again later.', 429, { resetAt: rate.resetAt });
    }

    // Best-effort: if the learner already has a course + note for this pair,
    // let it inform the placement emphasis. Placement often precedes the course,
    // in which case there is simply no note yet.
    const existingCourse = await prisma.course.findUnique({
      where: { userId_nativeLang_targetLang: { userId, nativeLang: native, targetLang: target } },
      select: { id: true },
    });
    const note = existingCourse ? await getCourseNote(existingCourse.id) : '';

    const { questions } = await generatePlacement(userId, native, target, note);

    // Cache the full questions (with answers) for grading; return public versions.
    await cache.set(cacheKey(userId, native, target), questions, 3600);
    return NextResponse.json({ native, target, questions: questions.map(toPublic) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Placement generation failed';
    logger.error('Placement generation failed', { error: message });
    return errorResponse(message, 500);
  }
}

/** POST /api/placement — submit answers, assign a CEFR level, create/update the course. */
export async function POST(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const userId = authed.userId;

    const parsed = submitSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse(parsed.error.issues[0].message, 400);
    const { native, target, answers } = parsed.data;
    if (native === target) return errorResponse('native and target must differ', 400);

    const questions = await cache.get<PlacementQuestion[]>(cacheKey(userId, native, target));
    if (!questions) return errorResponse('Placement session expired. Start the test again.', 409);

    const curriculum = await getOrCreateCurriculum(userId, native, target);
    const outcome = scorePlacement(questions, answers);

    // Safe re-take: when a learner re-takes placement for a pair they already
    // have, keep the original startLevel and never lower currentLevel (only
    // raise), so re-testing can never discard progress made through classes.
    const existing = await prisma.course.findUnique({
      where: { userId_nativeLang_targetLang: { userId, nativeLang: native, targetLang: target } },
      select: { currentLevel: true },
    });
    const nextCurrentLevel = existing ? higherLevel(existing.currentLevel, outcome.level) : outcome.level;

    const course = await prisma.course.upsert({
      where: { userId_nativeLang_targetLang: { userId, nativeLang: native, targetLang: target } },
      create: {
        userId,
        nativeLang: native,
        targetLang: target,
        curriculumId: curriculum.id,
        currentLevel: outcome.level,
        startLevel: outcome.level,
      },
      // startLevel is intentionally not updated — it is the immutable first
      // placement. currentLevel only moves up.
      update: { currentLevel: nextCurrentLevel },
    });

    await prisma.placementResult.upsert({
      where: { courseId: course.id },
      create: {
        courseId: course.id,
        level: outcome.level,
        responses: outcome.responses,
        scoreBySkill: outcome.scoreBySkill,
      },
      update: { level: outcome.level, responses: outcome.responses, scoreBySkill: outcome.scoreBySkill },
    });

    await cache.delete(cacheKey(userId, native, target)).catch(() => {});

    return NextResponse.json({ courseId: course.id, level: outcome.level, scoreBySkill: outcome.scoreBySkill });
  } catch (error: unknown) {
    logger.error('Placement submission failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Placement submission failed', 500);
  }
}
