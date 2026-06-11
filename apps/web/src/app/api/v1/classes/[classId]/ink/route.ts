import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

const inkLayerSchema = z.object({
  surface: z.string().min(1).max(120),
  strokes: z.string().max(5_000_000),
});

type RouteParams = { params: Promise<{ classId: string }> };

/**
 * POST /api/classes/[classId]/ink
 * Upserts a ClassInkLayer record (by classId + surface).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { classId } = await params;

    const cls = await prisma.courseClass.findFirst({
      where: { id: classId, course: { userId: authed.userId } },
      select: { id: true },
    });
    if (!cls) return errorResponse('Class not found', 404);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const parsed = inkLayerSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request body', 400, { details: parsed.error.flatten() });
    }

    const { surface, strokes } = parsed.data;

    await prisma.classInkLayer.upsert({
      where: { classId_surface: { classId, surface } },
      create: { classId, surface, strokes },
      update: { strokes },
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    logger.error('Failed to save ink layer', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to save ink layer', 500);
  }
}

/**
 * GET /api/classes/[classId]/ink
 * Returns all ink layers for this class.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { classId } = await params;

    const cls = await prisma.courseClass.findFirst({
      where: { id: classId, course: { userId: authed.userId } },
      select: { id: true },
    });
    if (!cls) return errorResponse('Class not found', 404);

    const layers = await prisma.classInkLayer.findMany({
      where: { classId },
      select: { surface: true, strokes: true, updatedAt: true },
      orderBy: { surface: 'asc' },
    });

    return NextResponse.json({ layers });
  } catch (error: unknown) {
    logger.error('Failed to load ink layers', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to load ink layers', 500);
  }
}
