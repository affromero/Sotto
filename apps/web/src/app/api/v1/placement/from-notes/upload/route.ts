import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { checkRateLimit } from '@/lib/redis';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { extractUploadTexts, isUploadFile } from '@/lib/note-upload';
import { runNotesDeduction } from '@/lib/placement-notes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const langCode = z.string().trim().toLowerCase().length(2);

/**
 * POST /api/v1/placement/from-notes/upload — web-only multipart variant of
 * /from-notes. Accepts `files` (uploaded materials) and/or a pasted `content`
 * field, extracts text server-side, then runs the same deduction + cache. Not
 * in the OpenAPI contract (multipart does not codegen); the TUI uses the JSON
 * /from-notes route with pasted text.
 */
export async function POST(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const userId = authed.userId;

    const form = await request.formData();
    const nativeParse = langCode.safeParse(form.get('native'));
    const targetParse = langCode.safeParse(form.get('target'));
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

    const files = form.getAll('files').filter(isUploadFile);
    const pasted = typeof form.get('content') === 'string' ? (form.get('content') as string).trim() : '';
    const { texts, failed } = await extractUploadTexts(files);
    const content = [pasted, ...texts].filter(Boolean).join('\n\n');
    if (!content) return errorResponse('No readable materials uploaded', 422);

    const deduction = await runNotesDeduction(userId, native, target, content);
    return NextResponse.json({
      native,
      target,
      deducedLevel: deduction.level,
      rationale: deduction.rationale,
      confidence: deduction.confidence,
      imported: texts.length,
      failed,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Level deduction failed';
    logger.error('Notes upload deduction failed', { error: message });
    return errorResponse(message, 500);
  }
}
