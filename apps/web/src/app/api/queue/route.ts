import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

import { errorResponse } from '@/lib/api-response';
const addToQueueSchema = z.object({
  podcastId: z.string(),
  source: z.enum(['picks', 'explore', 'following', 'search']).default('explore'),
});

const reorderSchema = z.object({
  podcastId: z.string(),
  newPosition: z.number().int().min(0),
});

const QUEUE_MAX = 10;

/**
 * GET /api/queue — User's listening queue.
 */
export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = authResult.userId;

  const queue = await prisma.listeningQueue.findMany({
    where: { userId, podcast: { deletedAt: null } },
    orderBy: { position: 'asc' },
    include: {
      podcast: {
        select: {
          id: true,
          title: true,
          topic: true,
          duration: true,
          audioUrl: true,
          playCount: true,
          createdAt: true,
          user: { select: { id: true, name: true, image: true } },
          tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
        },
      },
    },
  });

  return NextResponse.json({
    queue: queue.map((item: (typeof queue)[0]) => ({
      ...item,
      podcast: {
        ...item.podcast,
        createdAt: item.podcast.createdAt.toISOString(),
        tags: item.podcast.tags.map(
          (pt: { tag: { id: string; name: string; slug: string } }) => pt.tag
        ),
      },
    })),
  });
}

/**
 * POST /api/queue — Add podcast to listening queue.
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = authResult.userId;

  const body = await request.json();
  const parsed = addToQueueSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  // Check queue size
  const currentCount = await prisma.listeningQueue.count({
    where: { userId },
  });

  if (currentCount >= QUEUE_MAX) {
    return errorResponse(`Queue is full (max ${QUEUE_MAX}). Remove a podcast first.`, 409);
  }

  // Get next position
  const maxPos = await prisma.listeningQueue.findFirst({
    where: { userId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const nextPosition = (maxPos?.position ?? -1) + 1;

  const item = await prisma.listeningQueue.upsert({
    where: {
      userId_podcastId: {
        userId,
        podcastId: parsed.data.podcastId,
      },
    },
    create: {
      userId,
      podcastId: parsed.data.podcastId,
      position: nextPosition,
      source: parsed.data.source,
    },
    update: {},
  });

  return NextResponse.json(item, { status: 201 });
}

/**
 * DELETE /api/queue — Remove podcast from queue.
 */
export async function DELETE(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = authResult.userId;

  const { searchParams } = request.nextUrl;
  const podcastId = searchParams.get('podcastId');
  if (!podcastId) {
    return errorResponse('podcastId required', 400);
  }

  await prisma.listeningQueue.deleteMany({
    where: { userId, podcastId },
  });

  return NextResponse.json({ removed: podcastId });
}

/**
 * PATCH /api/queue — Reorder queue item.
 */
export async function PATCH(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = authResult.userId;

  const body = await request.json();
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  await prisma.listeningQueue.updateMany({
    where: { userId, podcastId: parsed.data.podcastId },
    data: { position: parsed.data.newPosition },
  });

  return NextResponse.json({ reordered: true });
}
