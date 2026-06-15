import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { checkRateLimit } from '@/lib/redis';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { runNotesDeduction } from '@/lib/placement-notes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const langCode = z.string().trim().toLowerCase().length(2);
const schema = z.object({
  native: langCode,
  target: langCode,
  content: z.string().trim().min(1).max(20000),
});

/**
 * POST /api/v1/placement/from-notes — deduce a CEFR level from pasted materials
 * (JSON). Returns { native, target, deducedLevel, rationale, confidence } and
 * caches the deduction for confirm/verify. Creates no course. Web file uploads
 * go through the multipart /from-notes/upload route, which forwards here.
 */
export async function POST(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const userId = authed.userId;

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return errorResponse(parsed.error.issues[0].message, 400);
    const { native, target, content } = parsed.data;
    if (native === target) return errorResponse('native and target must differ', 400);

    const rate = await checkRateLimit(`placement:${userId}`, 10, 3600);
    if (!rate.allowed) {
      return errorResponse('Rate limit exceeded. Try again later.', 429, { resetAt: rate.resetAt });
    }

    const deduction = await runNotesDeduction(userId, native, target, content);
    return NextResponse.json({
      native,
      target,
      deducedLevel: deduction.level,
      rationale: deduction.rationale,
      confidence: deduction.confidence,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Level deduction failed';
    logger.error('Notes deduction failed', { error: message });
    return errorResponse(message, 500);
  }
}
