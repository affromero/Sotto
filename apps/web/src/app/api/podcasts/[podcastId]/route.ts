import { NextRequest, NextResponse } from 'next/server';
import { prisma, prismaUnfiltered } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { updatePodcastSchema } from '@/lib/validations';
import { getTierFeatures } from '@/lib/tier-features';
import { hasByokKey } from '@/lib/byok';
import { PODCAST_PUBLIC_SELECT } from '@/lib/podcast-select';
import { resolveAudioUrl } from '@/lib/r2';
import { generatePodcastSlug } from '@/lib/slugify';
import { errorResponse } from '@/lib/api-response';
import { cache, getPodcastCacheTtl } from '@/lib/redis';
type RouteParams = { params: Promise<{ podcastId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  // Try Redis cache first (shared, non-user-specific data)
  const cacheKey = `podcast:public:${podcastId}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let podcast: Record<string, any> | null = await cache.get(cacheKey);

  if (!podcast) {
    podcast = await prisma.podcast.findUnique({
      where: { id: podcastId },
      select: {
        ...PODCAST_PUBLIC_SELECT,
        verificationProgress: true,
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

    if (podcast) {
      const ttl = getPodcastCacheTtl(podcast.status);
      await cache.set(cacheKey, podcast, ttl);
    }
  }

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  // Private podcasts require ownership
  if (podcast.visibility === 'PRIVATE') {
    if (!authResult || authResult.userId !== podcast.userId) {
      return errorResponse('Not found', 404);
    }
  }

  // Per-user fields fetched separately (cheap, not cached)
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

  // Resolve audio URLs: presigned for PRIVATE/UNLISTED, public CDN for PUBLIC
  const [resolvedAudioUrl, resolvedSegments] = await Promise.all([
    resolveAudioUrl(podcast.audioUrl, podcast.visibility),
    Promise.all(
      podcast.segments.map(async (s: Record<string, unknown>) => ({
        ...s,
        audioUrl: await resolveAudioUrl(s.audioUrl as string | null, podcast.visibility),
      }))
    ),
  ]);

  return NextResponse.json({
    ...podcast,
    audioUrl: resolvedAudioUrl,
    segments: resolvedSegments,
    isLiked,
    isSaved,
  });
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

  // Regenerate slug when title changes
  const slugData = updateData.title
    ? { slug: await generatePodcastSlug(updateData.title, authResult.userId, prisma) }
    : {};

  const updated = await prisma.podcast.update({
    where: { id: podcastId },
    data: {
      ...updateData,
      ...slugData,
      ...(dismissSuggestion && { suggestedTitle: null, suggestedTopic: null }),
    },
    select: {
      ...PODCAST_PUBLIC_SELECT,
      user: { select: { id: true, name: true, handle: true, image: true } },
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
