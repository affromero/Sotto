import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import {
  addLearningTarget,
  listLearningTargets,
  LearningTargetCourseNotFoundError,
  LearningTargetUnavailableError,
} from '@/lib/learning-targets';
import { logger } from '@/lib/logger';

type RouteParams = { params: Promise<{ courseId: string }> };

const targetKindSchema = z.enum(['WORD', 'PHRASE', 'SENTENCE']);
const targetSourceSchema = z.enum(['TRANSCRIPT', 'CLASS', 'PRACTICE', 'NOTES', 'LIVE', 'MANUAL']);

const addTargetSchema = z.object({
  text: z.string().min(1).max(500),
  kind: targetKindSchema.optional(),
  contextText: z.string().max(2000).nullable().optional(),
  sourceType: targetSourceSchema.optional(),
  sourceId: z.string().max(200).nullable().optional(),
  sourceLabel: z.string().max(200).nullable().optional(),
  userMarkedDifficulty: z.number().int().min(1).max(5).optional(),
});

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { courseId } = await params;
    const limitParam = request.nextUrl.searchParams.get('limit');
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 30;
    const targets = await listLearningTargets(courseId, authed.userId, Number.isFinite(limit) ? limit : 30);
    return NextResponse.json({ targets });
  } catch (error: unknown) {
    if (error instanceof LearningTargetCourseNotFoundError) return errorResponse('Course not found', 404);
    logger.error('Failed to list learning targets', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to list learning targets', 500);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { courseId } = await params;
    const parsed = addTargetSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse('Invalid learning target', 400);
    const target = await addLearningTarget(courseId, authed.userId, parsed.data);
    return NextResponse.json(target, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof LearningTargetCourseNotFoundError) return errorResponse('Course not found', 404);
    if (error instanceof LearningTargetUnavailableError) {
      return errorResponse(error.message, 422);
    }
    logger.error('Failed to add learning target', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to add learning target', 500);
  }
}
