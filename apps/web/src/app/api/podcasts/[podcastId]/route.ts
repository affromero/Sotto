import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { updatePodcastSchema } from '@/lib/validations';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

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
    if (!authResult || authResult.userId !== podcast.userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  }

  // Check if the authenticated user has liked/saved this podcast
  let isLiked = false;
  let isSaved = false;

  if (authResult) {
    const [like, save] = await Promise.all([
      prisma.like.findUnique({
        where: { userId_podcastId: { userId: authResult.userId, podcastId } },
      }),
      prisma.save.findUnique({
        where: { userId_podcastId: { userId: authResult.userId, podcastId } },
      }),
    ]);

    isLiked = !!like;
    isSaved = !!save;
  }

  return NextResponse.json({ ...podcast, isLiked, isSaved });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  if (podcast.userId !== authResult.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = updatePodcastSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { dismissSuggestion, ...updateData } = parsed.data;

  const updated = await prisma.podcast.update({
    where: { id: podcastId },
    data: {
      ...updateData,
      ...(dismissSuggestion && { suggestedTitle: null, suggestedTopic: null }),
    },
    include: {
      user: { select: { id: true, name: true, image: true } },
      tags: { include: { tag: true } },
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  if (podcast.userId !== authResult.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.podcast.delete({ where: { id: podcastId } });

  return new NextResponse(null, { status: 204 });
}
