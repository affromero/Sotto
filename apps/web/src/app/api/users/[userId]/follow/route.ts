import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const { userId } = await params;

  if (session.user.id === userId) {
    return errorResponse('Cannot follow yourself', 400);
  }

  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser) {
    return errorResponse('User not found', 404);
  }

  try {
    await prisma.follow.create({
      data: {
        followerId: session.user.id,
        followingId: userId,
      },
    });
  } catch (error: unknown) {
    // Handle unique constraint violation (already following)
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code: string }).code === 'P2002'
    ) {
      return NextResponse.json({ following: true });
    }
    throw error;
  }

  // Fire-and-forget activity record
  prisma.activity.create({
    data: {
      userId: session.user.id,
      type: 'USER_FOLLOWED',
      targetId: userId,
      targetType: 'user',
    },
  }).catch(() => {});

  return NextResponse.json({ following: true }, { status: 201 });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const { userId } = await params;

  try {
    await prisma.follow.delete({
      where: {
        followerId_followingId: {
          followerId: session.user.id,
          followingId: userId,
        },
      },
    });
  } catch (error: unknown) {
    // Handle not found (not following)
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code: string }).code === 'P2025'
    ) {
      return NextResponse.json({ following: false });
    }
    throw error;
  }

  return NextResponse.json({ following: false });
}
