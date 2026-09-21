import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { interactionSchema } from '@/lib/validations';
import { interactionQueue, admitDurableJob, JobType } from '@/lib/queue';
import { checkRateLimit } from '@/lib/redis';
import type { ProcessInteractionPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { randomUUID } from 'node:crypto';
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
  const interactionId = randomUUID();
  const payload: ProcessInteractionPayload = {
    episodeId,
    interactionId,
    userId: authResult.userId,
    question,
    timestamp,
  };

  let interaction: Awaited<ReturnType<typeof prisma.interaction.create>> | null = null;
  await admitDurableJob(interactionQueue, JobType.PROCESS_INTERACTION, payload, {
    jobId: `interaction-${interactionId}`,
    authorize: async (database) => {
      await requireOriginalSottoAdmission(database, request, authResult);
      const current = await database.episode.findUnique({
        where: { id: episodeId },
        select: { userId: true, visibility: true },
      });
      if (!current || (current.userId !== authResult.userId && current.visibility !== 'UNLISTED'))
        throw new Error('Episode interaction authority changed');
      return { userId: authResult.userId };
    },
    mutate: async (database) => {
      interaction = await database.interaction.create({
        data: {
          id: interactionId,
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
    },
  });
  if (!interaction) throw new Error('Interaction admission did not commit');

  return NextResponse.json(interaction, { status: 201 });
}
