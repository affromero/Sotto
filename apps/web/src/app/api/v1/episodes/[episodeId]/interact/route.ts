import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { interactionSchema } from '@/lib/validations';
import { interactionQueue, addJob, JobType } from '@/lib/queue';
import { checkRateLimit } from '@/lib/redis';
import type { ProcessInteractionPayload } from '@/lib/queue';

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
    select: { id: true, userId: true, title: true, visibility: true },
  });

  if (!episode) {
    return errorResponse('Episode not found', 404);
  }

  // Ownership/visibility guard mirrors the GET poll route: a non-owner may only
  // interact with a shared (UNLISTED) episode. Use 404 to avoid leaking the
  // existence of another learner's PRIVATE episode.
  const isEpisodeOwner = episode.userId === authResult.userId;
  const isShared = episode.visibility === 'UNLISTED';
  if (!isEpisodeOwner && !isShared) {
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

  return NextResponse.json(interaction, { status: 201 });
}
