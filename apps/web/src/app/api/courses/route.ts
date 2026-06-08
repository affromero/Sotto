import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { pairToLangs } from '@/lib/placement-test';

const createSchema = z.object({ pair: z.enum(['DE_FROM_EN', 'EN_FROM_ES', 'ES_FROM_EN']) });

/** GET /api/courses — list the signed-in learner's courses. */
export async function GET(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);

    const courses = await prisma.course.findMany({
      where: { userId: authed.userId },
      select: {
        id: true,
        pair: true,
        nativeLang: true,
        targetLang: true,
        currentLevel: true,
        startLevel: true,
        activeClassId: true,
        curriculum: { select: { title: true } },
        placement: { select: { level: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ courses });
  } catch (error: unknown) {
    logger.error('Failed to list courses', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to list courses', 500);
  }
}

/** POST /api/courses { pair } — start a course at A1 (skip placement). */
export async function POST(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const userId = authed.userId;

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse(parsed.error.errors[0].message, 400);
    const { pair } = parsed.data;

    const curriculum = await prisma.curriculum.findUnique({ where: { pair } });
    if (!curriculum) return errorResponse('No curriculum available for this language pair.', 400);

    const { native, target } = pairToLangs(pair);
    const course = await prisma.course.upsert({
      where: { userId_pair: { userId, pair } },
      create: { userId, pair, nativeLang: native, targetLang: target, curriculumId: curriculum.id },
      update: {},
    });

    return NextResponse.json({ course }, { status: 201 });
  } catch (error: unknown) {
    logger.error('Failed to create course', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to create course', 500);
  }
}
