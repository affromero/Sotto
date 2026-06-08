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
  pairToLangs,
  toPublic,
  type PlacementQuestion,
} from '@/lib/placement-test';

const pairSchema = z.enum(['DE_FROM_EN', 'EN_FROM_ES', 'ES_FROM_EN']);
const submitSchema = z.object({
  pair: pairSchema,
  answers: z
    .array(z.object({ id: z.string(), selectedIndex: z.number().int().min(0).max(3) }))
    .min(1),
});

const cacheKey = (userId: string, pair: string) => `placement:${userId}:${pair}`;

/** GET /api/placement?pair=DE_FROM_EN — generate an adaptive placement batch. */
export async function GET(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const userId = authed.userId;

    const pairParse = pairSchema.safeParse(request.nextUrl.searchParams.get('pair'));
    if (!pairParse.success) return errorResponse('Invalid or missing "pair"', 400);
    const pair = pairParse.data;

    const rate = await checkRateLimit(`placement:${userId}`, 10, 3600);
    if (!rate.allowed) {
      return errorResponse('Rate limit exceeded. Try again later.', 429, { resetAt: rate.resetAt });
    }

    const { native, target } = pairToLangs(pair);
    const { questions } = await generatePlacement(userId, native, target);

    // Cache the full questions (with answers) for grading; return public versions.
    await cache.set(cacheKey(userId, pair), questions, 3600);
    return NextResponse.json({ pair, questions: questions.map(toPublic) });
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
    if (!parsed.success) return errorResponse(parsed.error.errors[0].message, 400);
    const { pair, answers } = parsed.data;

    const questions = await cache.get<PlacementQuestion[]>(cacheKey(userId, pair));
    if (!questions) return errorResponse('Placement session expired. Start the test again.', 409);

    const curriculum = await prisma.curriculum.findUnique({ where: { pair } });
    if (!curriculum) return errorResponse('No curriculum available for this language pair.', 400);

    const outcome = scorePlacement(questions, answers);
    const { native, target } = pairToLangs(pair);

    const course = await prisma.course.upsert({
      where: { userId_pair: { userId, pair } },
      create: {
        userId,
        pair,
        nativeLang: native,
        targetLang: target,
        curriculumId: curriculum.id,
        currentLevel: outcome.level,
        startLevel: outcome.level,
      },
      update: { currentLevel: outcome.level, startLevel: outcome.level },
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

    await cache.delete(cacheKey(userId, pair)).catch(() => {});

    return NextResponse.json({ courseId: course.id, level: outcome.level, scoreBySkill: outcome.scoreBySkill });
  } catch (error: unknown) {
    logger.error('Placement submission failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Placement submission failed', 500);
  }
}
