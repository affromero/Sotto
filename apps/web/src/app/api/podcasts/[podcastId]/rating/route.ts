import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { podcastRatingSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
interface RouteContext {
  params: Promise<{ podcastId: string }>;
}

/**
 * GET /api/podcasts/[podcastId]/rating — Get current user's rating for this podcast
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return errorResponse('Unauthorized', 401);
  }

  const { podcastId } = await context.params;

  const rating = await prisma.podcastRating.findUnique({
    where: {
      userId_podcastId: {
        userId: session.user.id,
        podcastId,
      },
    },
  });

  return NextResponse.json({ rating });
}

/**
 * POST /api/podcasts/[podcastId]/rating — Submit or update rating (creator + listener)
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return errorResponse('Unauthorized', 401);
  }

  const { podcastId } = await context.params;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true, status: true, visibility: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  const isCreator = podcast.userId === session.user.id;

  if (!isCreator) {
    if (podcast.status !== 'READY') {
      return errorResponse('Podcast is not ready', 400);
    }
    if (podcast.visibility === 'PRIVATE') {
      return errorResponse('Cannot rate a private podcast', 403);
    }
  }

  const body = await request.json();
  const parsed = podcastRatingSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid rating data', 400, { details: parsed.error.flatten() });
  }

  const { completionPercent, ...ratingData } = parsed.data;

  const rating = await prisma.podcastRating.upsert({
    where: {
      userId_podcastId: {
        userId: session.user.id,
        podcastId,
      },
    },
    create: {
      userId: session.user.id,
      podcastId,
      isCreator,
      completionPercent: completionPercent ?? null,
      ...ratingData,
    },
    update: {
      ...ratingData,
      completionPercent: completionPercent ?? undefined,
    },
  });

  return NextResponse.json({ rating });
}
