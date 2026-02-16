import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkAutoTweetThreshold } from '@/lib/twitter-auto-tweet';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
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

  // Fire-and-forget auto-tweet threshold check (after transaction committed)
  checkAutoTweetThreshold(podcastId).catch(() => {});

  return NextResponse.json({ liked: true });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

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
