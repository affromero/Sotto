import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { notificationQueue, addJob, JobType } from '@/lib/queue';
import type { SendNotificationPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string; interactionId: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { podcastId, interactionId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = session.user.id;

  const interaction = await prisma.interaction.findUnique({
    where: { id: interactionId },
    select: { id: true, podcastId: true, visibility: true, userId: true },
  });

  if (!interaction || interaction.podcastId !== podcastId) {
    return errorResponse('Interaction not found', 404);
  }

  if (interaction.visibility !== 'PUBLIC') {
    return errorResponse('Cannot vote on private interactions', 403);
  }

  const existingVote = await prisma.interactionVote.findUnique({
    where: { userId_interactionId: { userId, interactionId } },
  });

  if (existingVote) {
    // Remove vote
    await prisma.$transaction(async (tx) => {
      await tx.interactionVote.delete({
        where: { userId_interactionId: { userId, interactionId } },
      });
      await tx.interaction.update({
        where: { id: interactionId },
        data: { upvoteCount: { decrement: 1 } },
      });
    });

    const updated = await prisma.interaction.findUnique({
      where: { id: interactionId },
      select: { upvoteCount: true },
    });

    return NextResponse.json({
      voted: false,
      upvoteCount: updated?.upvoteCount ?? 0,
    });
  }

  // Create vote
  await prisma.$transaction(async (tx) => {
    await tx.interactionVote.create({
      data: { userId, interactionId },
    });
    await tx.interaction.update({
      where: { id: interactionId },
      data: { upvoteCount: { increment: 1 } },
    });
  });

  const updated = await prisma.interaction.findUnique({
    where: { id: interactionId },
    select: { upvoteCount: true },
  });

  // Fire-and-forget notification for question author
  if (interaction.userId && interaction.userId !== userId) {
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
      .then((voter) => {
        const payload: SendNotificationPayload = {
          userId: interaction.userId,
          type: 'QUESTION_UPVOTED',
          title: 'Your question was upvoted',
          message: `${voter?.name ?? 'Someone'} upvoted your question`,
          data: { podcastId, interactionId },
        };
        return addJob(notificationQueue, JobType.SEND_NOTIFICATION, payload);
      })
      .catch(() => {});
  }

  return NextResponse.json({
    voted: true,
    upvoteCount: updated?.upvoteCount ?? 0,
  });
}
