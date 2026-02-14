import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type RouteParams = { params: Promise<{ podcastId: string; interactionId: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { podcastId, interactionId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  const interaction = await prisma.interaction.findUnique({
    where: { id: interactionId },
    select: { id: true, podcastId: true, visibility: true },
  });

  if (!interaction || interaction.podcastId !== podcastId) {
    return NextResponse.json({ error: 'Interaction not found' }, { status: 404 });
  }

  if (interaction.visibility !== 'PUBLIC') {
    return NextResponse.json({ error: 'Cannot vote on private interactions' }, { status: 403 });
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

  return NextResponse.json({
    voted: true,
    upvoteCount: updated?.upvoteCount ?? 0,
  });
}
