import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { collectionItemSchema } from '@/lib/validations';
import { logger } from '@/lib/logger';
import { Prisma } from '@prisma/client';

type RouteParams = { params: Promise<{ collectionId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { collectionId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { userId: true, _count: { select: { items: true } } },
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

  const parsed = collectionItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { podcastId } = parsed.data;

  // Verify podcast exists
  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  try {
    const nextOrder = collection._count.items;

    await prisma.$transaction(async (tx) => {
      await tx.collectionItem.create({
        data: {
          collectionId,
          podcastId,
          order: nextOrder,
        },
      });

      await tx.collection.update({
        where: { id: collectionId },
        data: { podcastCount: { increment: 1 } },
      });
    });

    logger.info('Podcast added to collection', { collectionId, podcastId });

    return NextResponse.json({ added: true }, { status: 201 });
  } catch (err) {
    // Handle duplicate gracefully (P2002 = unique constraint violation)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ added: true, alreadyExists: true });
    }
    throw err;
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

  const parsed = collectionItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { podcastId } = parsed.data;

  const existing = await prisma.collectionItem.findUnique({
    where: {
      collectionId_podcastId: { collectionId, podcastId },
    },
  });

  if (!existing) {
    return NextResponse.json({ removed: true });
  }

  await prisma.$transaction(async (tx) => {
    await tx.collectionItem.delete({
      where: {
        collectionId_podcastId: { collectionId, podcastId },
      },
    });

    await tx.collection.update({
      where: { id: collectionId },
      data: { podcastCount: { decrement: 1 } },
    });
  });

  logger.info('Podcast removed from collection', { collectionId, podcastId });

  return NextResponse.json({ removed: true });
}
