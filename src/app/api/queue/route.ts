import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

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
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const queue = await prisma.listeningQueue.findMany({
    where: { userId: session.user.id },
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
          likeCount: true,
          forkCount: true,
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
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const parsed = addToQueueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Check queue size
  const currentCount = await prisma.listeningQueue.count({
    where: { userId: session.user.id },
  });

  if (currentCount >= QUEUE_MAX) {
    return NextResponse.json(
      { error: `Queue is full (max ${QUEUE_MAX}). Remove a podcast first.` },
      { status: 409 }
    );
  }

  // Get next position
  const maxPos = await prisma.listeningQueue.findFirst({
    where: { userId: session.user.id },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const nextPosition = (maxPos?.position ?? -1) + 1;

  const item = await prisma.listeningQueue.upsert({
    where: {
      userId_podcastId: {
        userId: session.user.id,
        podcastId: parsed.data.podcastId,
      },
    },
    create: {
      userId: session.user.id,
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
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const podcastId = searchParams.get('podcastId');
  if (!podcastId) {
    return NextResponse.json({ error: 'podcastId required' }, { status: 400 });
  }

  await prisma.listeningQueue.deleteMany({
    where: { userId: session.user.id, podcastId },
  });

  return NextResponse.json({ removed: podcastId });
}

/**
 * PATCH /api/queue — Reorder queue item.
 */
export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await prisma.listeningQueue.updateMany({
    where: { userId: session.user.id, podcastId: parsed.data.podcastId },
    data: { position: parsed.data.newPosition },
  });

  return NextResponse.json({ reordered: true });
}
