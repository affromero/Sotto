import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

type RouteParams = { params: Promise<{ userId: string }> };

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { userId } = await params;
  const session = await auth();

  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  if (session.user.id === userId) {
    return errorResponse('You cannot remove yourself', 400);
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, email: true },
  });

  if (!targetUser) {
    return errorResponse('User not found', 404);
  }

  if (targetUser.role === 'ADMIN') {
    return errorResponse('Cannot remove admin users', 400);
  }

  // Delete user and all cascading relations
  await prisma.user.delete({ where: { id: userId } });

  logger.info('Admin removed user', {
    removedUserId: userId,
    removedEmail: targetUser.email,
    adminId: session.user.id,
  });

  return NextResponse.json({ success: true });
}
