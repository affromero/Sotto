import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type RouteParams = { params: Promise<{ podcastId: string; interactionId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { podcastId, interactionId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const interaction = await prisma.interaction.findUnique({
    where: { id: interactionId, podcastId },
    select: {
      id: true,
      question: true,
      timestamp: true,
      status: true,
      answer: true,
      helpful: true,
      segmentOrder: true,
      userId: true,
      podcast: {
        select: { userId: true, visibility: true },
      },
    },
  });

  if (!interaction) {
    return NextResponse.json({ error: 'Interaction not found' }, { status: 404 });
  }

  const isOwner = interaction.userId === session.user.id;
  const isPodcastOwner = interaction.podcast.userId === session.user.id;
  const isPublic = interaction.podcast.visibility === 'PUBLIC';

  if (!isOwner && !isPodcastOwner && !isPublic) {
    return NextResponse.json({ error: 'Interaction not found' }, { status: 404 });
  }

  const { userId: _u, podcast: _p, ...safeInteraction } = interaction;

  return NextResponse.json(safeInteraction);
}
