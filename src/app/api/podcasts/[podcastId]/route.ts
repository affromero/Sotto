import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updatePodcastSchema } from '@/lib/validations';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    include: {
      user: { select: { id: true, name: true, image: true } },
      tags: { include: { tag: true } },
      segments: { orderBy: { order: 'asc' } },
      interactions: {
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, image: true } },
        },
      },
    },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  // Private/unlisted podcasts require ownership
  if (podcast.visibility !== 'PUBLIC') {
    if (!session?.user?.id || session.user.id !== podcast.userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  }

  // Check if the authenticated user has liked/saved this podcast
  let isLiked = false;
  let isSaved = false;

  if (session?.user?.id) {
    const [like, save] = await Promise.all([
      prisma.like.findUnique({
        where: { userId_podcastId: { userId: session.user.id, podcastId } },
      }),
      prisma.save.findUnique({
        where: { userId_podcastId: { userId: session.user.id, podcastId } },
      }),
    ]);

    isLiked = !!like;
    isSaved = !!save;
  }

  return NextResponse.json({ ...podcast, isLiked, isSaved });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  if (podcast.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = updatePodcastSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.podcast.update({
    where: { id: podcastId },
    data: parsed.data,
    include: {
      user: { select: { id: true, name: true, image: true } },
      tags: { include: { tag: true } },
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  if (podcast.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.podcast.delete({ where: { id: podcastId } });

  return new NextResponse(null, { status: 204 });
}
