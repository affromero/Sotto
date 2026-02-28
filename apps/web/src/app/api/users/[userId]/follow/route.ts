import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { notificationQueue, addJob, JobType } from '@/lib/queue';
import type { SendNotificationPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const { userId } = await params;

  if (authResult.userId === userId) {
    return errorResponse('Cannot follow yourself', 400);
  }

  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser) {
    return errorResponse('User not found', 404);
  }

  try {
    await prisma.follow.create({
      data: {
        followerId: authResult.userId,
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
      userId: authResult.userId,
      type: 'USER_FOLLOWED',
      targetId: userId,
      targetType: 'user',
    },
  }).catch(() => {});

  // Fire-and-forget notification for followed user
  prisma.user.findUnique({ where: { id: authResult.userId }, select: { name: true } })
    .then((follower) => {
      const payload: SendNotificationPayload = {
        userId,
        type: 'NEW_FOLLOWER',
        title: 'New follower',
        message: `${follower?.name ?? 'Someone'} started following you`,
        data: { followerId: authResult.userId },
      };
      return addJob(notificationQueue, JobType.SEND_NOTIFICATION, payload);
    })
    .catch(() => {});

  return NextResponse.json({ following: true }, { status: 201 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const { userId } = await params;

  try {
    await prisma.follow.delete({
      where: {
        followerId_followingId: {
          followerId: authResult.userId,
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
