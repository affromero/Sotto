import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ episodeId: string; interactionId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { episodeId, interactionId } = await params;
  const authed = await authenticateRequest(request);

  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }
  const userId = authed.userId;

  const interaction = await prisma.interaction.findUnique({
    where: { id: interactionId, episodeId },
    select: {
      id: true,
      question: true,
      timestamp: true,
      status: true,
      answer: true,
      helpful: true,
      segmentOrder: true,
      userId: true,
      episode: {
        select: { userId: true, visibility: true },
      },
    },
  });

  if (!interaction) {
    return errorResponse('Interaction not found', 404);
  }

  const isOwner = interaction.userId === userId;
  const isEpisodeOwner = interaction.episode.userId === userId;
  const isShared = interaction.episode.visibility === 'UNLISTED';

  if (!isOwner && !isEpisodeOwner && !isShared) {
    return errorResponse('Interaction not found', 404);
  }

  const { userId: _u, episode: _p, ...safeInteraction } = interaction;

  return NextResponse.json(safeInteraction);
}
