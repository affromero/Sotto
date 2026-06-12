import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ episodeId: string; interactionId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { episodeId, interactionId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

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

  const isOwner = interaction.userId === session.user.id;
  const isEpisodeOwner = interaction.episode.userId === session.user.id;
  const isPublic = interaction.episode.visibility === 'PUBLIC';

  if (!isOwner && !isEpisodeOwner && !isPublic) {
    return errorResponse('Interaction not found', 404);
  }

  const { userId: _u, episode: _p, ...safeInteraction } = interaction;

  return NextResponse.json(safeInteraction);
}
