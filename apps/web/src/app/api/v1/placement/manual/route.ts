import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { checkRateLimit } from '@/lib/redis';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { createOrRaiseCourse } from '@/lib/placement-course';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const langCode = z.string().trim().toLowerCase().length(2);
const cefrLevel = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
const schema = z.object({ native: langCode, target: langCode, level: cefrLevel });

/**
 * POST /api/v1/placement/manual — the learner declares their own CEFR level
 * without a test. Creates the course at that level, or (for an existing course)
 * raises to it. Lowering is intentionally impossible here: dropping a level
 * would desync the SRS graph, so that path is a destructive course reset.
 * Records placementSource = MANUAL so the UI can nudge the learner to verify.
 */
export async function POST(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const userId = authed.userId;

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return errorResponse(parsed.error.issues[0].message, 400);
    const { native, target, level } = parsed.data;
    if (native === target) return errorResponse('native and target must differ', 400);

    // Rate-limit before createOrRaiseCourse: it can trigger on-demand curriculum
    // generation, which is expensive. Shares the placement budget.
    const rate = await checkRateLimit(`placement:${userId}`, 10, 3600);
    if (!rate.allowed) {
      return errorResponse('Rate limit exceeded. Try again later.', 429, { resetAt: rate.resetAt });
    }

    const course = await createOrRaiseCourse(userId, native, target, level, 'MANUAL');
    return NextResponse.json({ courseId: course.id, level: course.currentLevel }, { status: 201 });
  } catch (error: unknown) {
    logger.error('Manual placement failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Manual placement failed', 500);
  }
}
