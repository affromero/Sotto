import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ collectionId: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { collectionId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = session.user.id;

  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { id: true, userId: true, isPublic: true },
  });

  if (!collection) {
    return errorResponse('Collection not found', 404);
  }

  // Can only follow public collections (or your own, though that's unusual)
  if (!collection.isPublic && collection.userId !== userId) {
    return errorResponse('Collection not found', 404);
  }

  // Check if already following
  const existing = await prisma.collectionFollow.findUnique({
    where: {
      userId_collectionId: { userId, collectionId },
    },
  });

  if (existing) {
    return NextResponse.json({ following: true });
  }

  await prisma.$transaction(async (tx) => {
    await tx.collectionFollow.create({
      data: { userId, collectionId },
    });

    await tx.collection.update({
      where: { id: collectionId },
      data: { followerCount: { increment: 1 } },
    });
  });

  return NextResponse.json({ following: true });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { collectionId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = session.user.id;

  const existing = await prisma.collectionFollow.findUnique({
    where: {
      userId_collectionId: { userId, collectionId },
    },
  });

  if (!existing) {
    return NextResponse.json({ following: false });
  }

  await prisma.$transaction(async (tx) => {
    await tx.collectionFollow.delete({
      where: {
        userId_collectionId: { userId, collectionId },
      },
    });

    await tx.collection.update({
      where: { id: collectionId },
      data: { followerCount: { decrement: 1 } },
    });
  });

  return NextResponse.json({ following: false });
}
