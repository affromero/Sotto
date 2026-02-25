import { NextRequest, NextResponse } from 'next/server';
import { prisma, prismaUnfiltered } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { updatePodcastSchema } from '@/lib/validations';
import { getTierFeatures } from '@/lib/tier-features';
import { hasByokKey } from '@/lib/byok';
import { PODCAST_PUBLIC_SELECT } from '@/lib/podcast-select';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: {
      ...PODCAST_PUBLIC_SELECT,
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
    return errorResponse('Podcast not found', 404);
  }

  // Private podcasts require ownership
  if (podcast.visibility === 'PRIVATE') {
    if (!authResult || authResult.userId !== podcast.userId) {
      return errorResponse('Not found', 404);
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
    return errorResponse('Unauthorized', 401);
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  if (podcast.userId !== authResult.userId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = updatePodcastSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { dismissSuggestion, ...updateData } = parsed.data;

  if (updateData.visibility === 'PRIVATE' || updateData.visibility === 'UNLISTED') {
    const [user, isByok] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: authResult.userId },
        select: { plan: true, role: true },
      }),
      hasByokKey(authResult.userId),
    ]);
    const tierFeatures = getTierFeatures(user.plan as 'FREE' | 'PRO', isByok, user.role);
    if (!tierFeatures.privateAllowed) {
      return errorResponse('Private and unlisted podcasts require a Pro subscription.', 403);
    }
  }

  const updated = await prisma.podcast.update({
    where: { id: podcastId },
    data: {
      ...updateData,
      ...(dismissSuggestion && { suggestedTitle: null, suggestedTopic: null }),
    },
    select: {
      ...PODCAST_PUBLIC_SELECT,
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
    return errorResponse('Unauthorized', 401);
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true, forkedFromId: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  if (podcast.userId !== authResult.userId) {
    return errorResponse('Forbidden', 403);
  }

  await prismaUnfiltered.$transaction(async (tx) => {
    // Disconnect forks so child podcasts aren't orphaned
    await tx.podcast.updateMany({
      where: { forkedFromId: podcastId },
      data: { forkedFromId: null },
    });

    // Decrement parent's forkCount if this podcast is a fork
    if (podcast.forkedFromId) {
      const parent = await tx.podcast.findUnique({
        where: { id: podcast.forkedFromId },
        select: { id: true },
      });
      if (parent) {
        await tx.podcast.update({
          where: { id: podcast.forkedFromId },
          data: { forkCount: { decrement: 1 } },
        });
      }
    }

    await tx.podcast.update({
      where: { id: podcastId },
      data: { deletedAt: new Date() },
    });
  });

  return new NextResponse(null, { status: 204 });
}
