import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { checkRateLimit } from '@/lib/redis';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { importCourseMaterials, readMaterialForm } from '@/lib/course-materials';
import { buildCourseSourceContext } from '@/lib/course-materials/context';
import { RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { isAccessError } from 'thesidedoor-core/access';
import { runNotesDeduction } from '@/lib/placement-notes';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

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
export function POST(request: NextRequest) {
  return accessOperation(request, !request.headers.has('authorization'), () => upload(request));
}

async function upload(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const userId = authed.userId;

    const { form, files } = await readMaterialForm(request);
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

    const parsedContent = z
      .string()
      .trim()
      .max(20000)
      .safeParse(form.get('content') ?? '');
    if (!parsedContent.success)
      return errorResponse('Pasted notes must contain at most 20,000 characters.', 400);
    const pasted = parsedContent.data;
    const { materials, failed } = await importCourseMaterials(request, authed, files);
    const documents = [
      ...(pasted ? [{ id: 'pasted-notes', name: 'Pasted learner notes', text: pasted }] : []),
      ...materials.map((material) => ({
        id: material.id,
        name: material.name,
        text: material.mimeType === 'application/pdf' ? '' : material.extractedText,
      })),
    ];
    if (!documents.length) return errorResponse('No readable materials uploaded', 422);
    const content = buildCourseSourceContext(documents, `${userId}:${native}:${target}`).text;

    const deduction = await runNotesDeduction(
      userId,
      sottoRequestExecution(request, authed),
      native,
      target,
      content,
      { materialIds: materials.map((material) => material.id), editableContent: pasted }
    );
    return NextResponse.json({
      native,
      target,
      deducedLevel: deduction.level,
      rationale: deduction.rationale,
      confidence: deduction.confidence,
      imported: materials.length,
      failed,
      materials,
    });
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError)
      return errorResponse('Materials must total 50MB or less.', 413);
    if (isAccessError(error)) throw error;
    const message = error instanceof Error ? error.message : 'Level deduction failed';
    logger.error('Notes upload deduction failed', { error: message });
    return errorResponse(message, 500);
  }
}
