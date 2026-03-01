import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

import { errorResponse } from '@/lib/api-response';
const updateRoleSchema = z.object({
  role: z.enum(['USER', 'ADMIN']),
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

  if (userId === session.user.id) {
    return errorResponse('Cannot change your own role', 400);
  }

  try {
    const body = await request.json();
    const { role } = updateRoleSchema.parse(body);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Invalid request', 400, { details: error.errors });
    }

    console.error('Error updating user role:', error);
    return errorResponse('Failed to update user role', 500);
  }
}
