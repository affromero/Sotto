import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updateCollectionSchema } from '@/lib/validations';
import { logger } from '@/lib/logger';

type RouteParams = { params: Promise<{ collectionId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { collectionId } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: {
      user: {
        select: { id: true, name: true, handle: true, image: true },
      },
      items: {
        orderBy: { order: 'asc' },
        include: {
          podcast: {
            select: {
              id: true,
              title: true,
              topic: true,
              status: true,
              visibility: true,
              audioUrl: true,
              duration: true,
              playCount: true,
              likeCount: true,
              forkCount: true,
              createdAt: true,
              source: true,
              isHumanContent: true,
              forkedFromId: true,
              user: {
                select: { id: true, name: true, handle: true, image: true },
              },
              tags: {
                include: {
                  tag: { select: { id: true, name: true, slug: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!collection) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
  }

  // Private collections are only visible to the owner
  if (!collection.isPublic && collection.userId !== userId) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
  }

  // Check if current user follows this collection
  let isFollowing = false;
  if (userId) {
    const follow = await prisma.collectionFollow.findUnique({
      where: {
        userId_collectionId: { userId, collectionId },
      },
    });
    isFollowing = !!follow;
  }

  // Filter out private/non-ready podcasts for non-owners
  const isOwner = collection.userId === userId;
  const items = collection.items
    .filter((item) => {
      if (isOwner) return true;
      return item.podcast.status === 'READY' && item.podcast.visibility === 'PUBLIC';
    })
    .map((item) => ({
      ...item.podcast,
      createdAt: item.podcast.createdAt.toISOString(),
      tags: item.podcast.tags.map((pt) => pt.tag),
      addedAt: item.addedAt.toISOString(),
      order: item.order,
    }));

  return NextResponse.json({
    id: collection.id,
    name: collection.name,
    description: collection.description,
    isPublic: collection.isPublic,
    podcastCount: collection.podcastCount,
    followerCount: collection.followerCount,
    createdAt: collection.createdAt.toISOString(),
    user: collection.user,
    items,
    isFollowing,
    isOwner,
  });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { collectionId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { userId: true },
  });

  if (!collection) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
  }

  if (collection.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = updateCollectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const updated = await prisma.collection.update({
    where: { id: collectionId },
    data: parsed.data,
    select: {
      id: true,
      name: true,
      description: true,
      isPublic: true,
      podcastCount: true,
      followerCount: true,
      createdAt: true,
    },
  });

  logger.info('Collection updated', { collectionId, userId: session.user.id });

  return NextResponse.json({ ...updated, createdAt: updated.createdAt.toISOString() });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { collectionId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { userId: true },
  });

  if (!collection) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
  }

  if (collection.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.collection.delete({ where: { id: collectionId } });

  logger.info('Collection deleted', { collectionId, userId: session.user.id });

  return NextResponse.json({ deleted: true });
}
