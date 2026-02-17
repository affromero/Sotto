import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { moderateUserSchema } from '@/lib/validations';
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
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (session.user.id === userId) {
    return NextResponse.json(
      { error: 'You cannot moderate yourself' },
      { status: 400 }
    );
  }

  const body = await request.json();
  const parsed = moderateUserSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { action, reason, durationDays } = parsed.data;

  // Verify target user exists
  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Cannot moderate other admins
  if (targetUser.role === 'ADMIN') {
    return NextResponse.json(
      { error: 'Cannot moderate admin users' },
      { status: 400 }
    );
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
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  return NextResponse.json({ success: true, action });
}
