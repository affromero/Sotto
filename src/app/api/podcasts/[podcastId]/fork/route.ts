import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  const sourcePodcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    include: {
      tags: { select: { tagId: true } },
    },
  });

  if (!sourcePodcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  if (sourcePodcast.visibility !== 'PUBLIC') {
    return NextResponse.json(
      { error: 'Only public podcasts can be forked' },
      { status: 403 }
    );
  }

  if (sourcePodcast.status !== 'READY') {
    return NextResponse.json(
      { error: 'Only podcasts with READY status can be forked' },
      { status: 400 }
    );
  }

  // Use a transaction to create fork, copy tags, and increment fork count
  const forkedPodcast = await prisma.$transaction(async (tx) => {
    const newPodcast = await tx.podcast.create({
      data: {
        userId,
        title: `Fork of ${sourcePodcast.title}`,
        topic: sourcePodcast.topic,
        status: 'PENDING',
        forkedFromId: podcastId,
      },
    });

    // Copy tags to the forked podcast
    if (sourcePodcast.tags.length > 0) {
      await tx.podcastTag.createMany({
        data: sourcePodcast.tags.map((pt) => ({
          podcastId: newPodcast.id,
          tagId: pt.tagId,
        })),
      });
    }

    // Increment source podcast fork count
    await tx.podcast.update({
      where: { id: podcastId },
      data: { forkCount: { increment: 1 } },
    });

    // Return the new podcast with relations
    return tx.podcast.findUnique({
      where: { id: newPodcast.id },
      include: {
        user: { select: { id: true, name: true, image: true } },
        tags: { include: { tag: true } },
      },
    });
  });

  return NextResponse.json(forkedPodcast, { status: 201 });
}
