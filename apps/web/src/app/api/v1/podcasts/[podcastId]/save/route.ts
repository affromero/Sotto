import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = authResult.userId;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  // Check if already saved to avoid double-incrementing the count
  const existing = await prisma.save.findUnique({
    where: {
      userId_podcastId: { userId, podcastId },
    },
  });

  if (existing) {
    return NextResponse.json({ saved: true });
  }

  // Use a transaction to atomically create save and increment count
  await prisma.$transaction(async (tx) => {
    await tx.save.create({
      data: {
        userId,
        podcastId,
      },
    });

    await tx.podcast.update({
      where: { id: podcastId },
      data: { saveCount: { increment: 1 } },
    });
  });

  return NextResponse.json({ saved: true });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = authResult.userId;

  const existing = await prisma.save.findUnique({
    where: {
      userId_podcastId: { userId, podcastId },
    },
  });

  if (!existing) {
    return NextResponse.json({ saved: false });
  }

  await prisma.$transaction(async (tx) => {
    await tx.save.delete({
      where: {
        userId_podcastId: { userId, podcastId },
      },
    });

    await tx.podcast.update({
      where: { id: podcastId },
      data: { saveCount: { decrement: 1 } },
    });
  });

  return NextResponse.json({ saved: false });
}
