import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { adminUpdateBadgeSchema } from '@/lib/validations';
import { notificationQueue, addJob, JobType } from '@/lib/queue';
import type { SendNotificationPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ podcastId: string }> }
) {
  const session = await auth();

  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const userRole = (session.user as Record<string, unknown>)?.role as string;

  if (userRole !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  const { podcastId } = await context.params;
  const body = await request.json();
  const parsed = adminUpdateBadgeSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { isHumanContent, reason } = parsed.data;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, title: true, userId: true, isHumanContent: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  await prisma.$transaction(async (tx) => {
    await tx.podcast.update({
      where: { id: podcastId },
      data: { isHumanContent },
    });

    await tx.moderationAction.create({
      data: {
        userId: podcast.userId,
        moderatorId: session.user!.id!,
        action: 'remove_content',
        reason,
        metadata: {
          podcastId,
          field: 'isHumanContent',
          oldValue: podcast.isHumanContent,
          newValue: isHumanContent,
        },
      },
    });
  });

  if (podcast.isHumanContent !== isHumanContent) {
    const title = isHumanContent ? 'Human Badge Restored' : 'Human Badge Removed';
    const message = isHumanContent
      ? `The Human Content badge has been restored on "${podcast.title}".`
      : `The Human Content badge has been removed from "${podcast.title}": ${reason}`;

    const payload: SendNotificationPayload = {
      userId: podcast.userId,
      type: 'CONTENT_REMOVED',
      title,
      message,
    };
    addJob(notificationQueue, JobType.SEND_NOTIFICATION, payload).catch(() => {});
  }

  return NextResponse.json({ success: true, isHumanContent });
}
