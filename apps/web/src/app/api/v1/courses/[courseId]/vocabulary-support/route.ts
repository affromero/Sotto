import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { vocabularySupportSchema } from '@sotto/shared';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

const schema = z.object({ vocabularySupport: vocabularySupportSchema.nullable() }).strict();
type RouteParams = { params: Promise<{ courseId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('Choose a supported vocabulary option.', 400);
  const { courseId } = await params;
  try {
    const changed = await prisma.course.updateMany({
      where: { id: courseId, userId: authed.userId },
      data: parsed.data,
    });
    if (changed.count !== 1) return errorResponse('Course not found', 404);
    return NextResponse.json(parsed.data);
  } catch (error) {
    logger.error('Failed to save vocabulary support', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Could not save vocabulary support.', 500);
  }
}
