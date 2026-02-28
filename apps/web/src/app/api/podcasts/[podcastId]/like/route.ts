import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { checkAutoTweetThreshold } from '@/lib/twitter-auto-tweet';
import { notificationQueue, addJob, JobType } from '@/lib/queue';
import type { SendNotificationPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = authResult.userId;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, userId: true, title: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  // Check if already liked to avoid double-incrementing the count
  const existing = await prisma.like.findUnique({
    where: {
      userId_podcastId: { userId, podcastId },
    },
  });

  if (existing) {
    return NextResponse.json({ liked: true });
  }

  // Use a transaction to atomically create like and increment count
  await prisma.$transaction(async (tx) => {
    await tx.like.create({
      data: {
        userId,
        podcastId,
      },
    });

    await tx.podcast.update({
      where: { id: podcastId },
      data: { likeCount: { increment: 1 } },
    });
  });

  // Fire-and-forget activity record
  prisma.activity.create({
    data: {
      userId,
      type: 'PODCAST_LIKED',
      targetId: podcastId,
      targetType: 'podcast',
    },
  }).catch(() => {});

  // Fire-and-forget notification for podcast owner
  if (podcast.userId && podcast.userId !== userId) {
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
      .then((liker) => {
        const payload: SendNotificationPayload = {
          userId: podcast.userId,
          type: 'PODCAST_LIKED',
          title: 'Someone liked your podcast',
          message: `${liker?.name ?? 'Someone'} liked "${podcast.title ?? 'your podcast'}"`,
          data: { podcastId },
        };
        return addJob(notificationQueue, JobType.SEND_NOTIFICATION, payload);
      })
      .catch(() => {});
  }

  // Fire-and-forget auto-tweet threshold check (after transaction committed)
  checkAutoTweetThreshold(podcastId).catch(() => {});

  return NextResponse.json({ liked: true });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = authResult.userId;

  const existing = await prisma.like.findUnique({
    where: {
      userId_podcastId: { userId, podcastId },
    },
  });

  if (!existing) {
    return NextResponse.json({ liked: false });
  }

  await prisma.$transaction(async (tx) => {
    await tx.like.delete({
      where: {
        userId_podcastId: { userId, podcastId },
      },
    });

    await tx.podcast.update({
      where: { id: podcastId },
      data: { likeCount: { decrement: 1 } },
    });
  });

  return NextResponse.json({ liked: false });
}
