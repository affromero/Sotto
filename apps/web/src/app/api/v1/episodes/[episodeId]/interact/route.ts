import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { interactionSchema } from '@/lib/validations';
import { interactionQueue, notificationQueue, addJob, JobType } from '@/lib/queue';
import { checkRateLimit } from '@/lib/redis';
import type { ProcessInteractionPayload, SendNotificationPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ episodeId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  // Rate limit: 60/hour
  const hourly = await checkRateLimit(`interact:hour:${authResult.userId}`, 60, 3600);
  if (!hourly.allowed) {
    return errorResponse('Rate limit exceeded: max 60 interactions per hour.', 429);
  }

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { id: true, userId: true, title: true },
  });

  if (!episode) {
    return errorResponse('Episode not found', 404);
  }

  const body = await request.json();
  const parsed = interactionSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { question, timestamp } = parsed.data;

  // Create interaction record
  const interaction = await prisma.interaction.create({
    data: {
      episodeId,
      userId: authResult.userId,
      question,
      timestamp,
      status: 'PENDING',
    },
    include: {
      user: { select: { id: true, name: true, image: true } },
    },
  });

  // Queue interaction processing job
  const payload: ProcessInteractionPayload = {
    episodeId,
    interactionId: interaction.id,
    userId: authResult.userId,
    question,
    timestamp,
  };

  await addJob(interactionQueue, JobType.PROCESS_INTERACTION, payload);

  // Fire-and-forget notification for episode owner
  if (episode.userId && episode.userId !== authResult.userId) {
    prisma.user.findUnique({ where: { id: authResult.userId }, select: { name: true } })
      .then((questioner) => {
        const truncated = question.length > 80 ? `${question.slice(0, 80)}...` : question;
        const notifPayload: SendNotificationPayload = {
          userId: episode.userId,
          type: 'QUESTION_ON_YOUR_EPISODE',
          title: 'New question on your episode',
          message: `${questioner?.name ?? 'Someone'} asked: "${truncated}"`,
          data: { episodeId, interactionId: interaction.id },
        };
        return addJob(notificationQueue, JobType.SEND_NOTIFICATION, notifPayload);
      })
      .catch(() => {});
  }

  return NextResponse.json(interaction, { status: 201 });
}
