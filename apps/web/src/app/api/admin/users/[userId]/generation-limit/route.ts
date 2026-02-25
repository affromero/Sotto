import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

import { errorResponse } from '@/lib/api-response';
const updateLimitSchema = z.object({
  dailyGenerationOverride: z.number().int().min(0).nullable(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return errorResponse('Unauthorized', 401);
  }

  const userRole = (session.user as Record<string, unknown>)?.role as string;

  if (userRole !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  const { userId } = await context.params;

  try {
    const body = await request.json();
    const { dailyGenerationOverride } = updateLimitSchema.parse(body);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { dailyGenerationOverride },
      select: {
        id: true,
        name: true,
        email: true,
        dailyGenerationOverride: true,
      },
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Invalid request', 400, { details: error.errors });
    }

    return errorResponse('Failed to update generation limit', 500);
  }
}
