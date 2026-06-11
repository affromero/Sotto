import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { moderateUserSchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';
import {
  banUser,
  unbanUser,
  suspendUser,
  unsuspendUser,
  warnUser,
} from '@/lib/user-moderation';

type RouteParams = { params: Promise<{ userId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { userId } = await params;
  const session = await auth();

  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  if (session.user.id === userId) {
    return errorResponse('You cannot moderate yourself', 400);
  }

  const body = await request.json();
  const parsed = moderateUserSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { action, reason, durationDays } = parsed.data;

  // Verify target user exists
  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!targetUser) {
    return errorResponse('User not found', 404);
  }

  // Cannot moderate other admins
  if (targetUser.role === 'ADMIN') {
    return errorResponse('Cannot moderate admin users', 400);
  }

  const base = { userId, moderatorId: session.user.id, reason };

  switch (action) {
    case 'warn':
      await warnUser(base);
      break;
    case 'suspend':
      await suspendUser({ ...base, durationDays: durationDays ?? 7 });
      break;
    case 'ban':
      await banUser(base);
      break;
    case 'unban':
      await unbanUser(base);
      break;
    case 'unsuspend':
      await unsuspendUser(base);
      break;
    default:
      return errorResponse('Invalid action', 400);
  }

  return NextResponse.json({ success: true, action });
}
