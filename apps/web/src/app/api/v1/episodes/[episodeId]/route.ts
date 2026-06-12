import { NextRequest, NextResponse } from 'next/server';
import { prisma, prismaUnfiltered } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { updateEpisodeSchema } from '@/lib/validations';
import { EPISODE_PUBLIC_SELECT } from '@/lib/episode-select';
import { resolveAudioUrl } from '@/lib/r2';
import { generateEpisodeSlug } from '@/lib/slugify';
import { errorResponse } from '@/lib/api-response';
import { cache, getEpisodeCacheTtl, invalidateEpisodeCache } from '@/lib/redis';
type RouteParams = { params: Promise<{ episodeId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
  const authResult = await authenticateRequest(request);

  // Try Redis cache first (shared, non-user-specific data)
  const cacheKey = `episode:public:${episodeId}`;
  let episode: Record<string, any> | null = await cache.get(cacheKey);
  if (episode?.visibility !== 'PUBLIC') {
    episode = null;
  }

  if (!episode) {
    episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: {
        ...EPISODE_PUBLIC_SELECT,
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

    if (episode?.visibility === 'PUBLIC') {
      const ttl = getEpisodeCacheTtl(episode.status);
      await cache.set(cacheKey, episode, ttl);
    }
  }

  if (!episode) {
    return errorResponse('Episode not found', 404);
  }

  // Private episodes require ownership
  if (episode.visibility === 'PRIVATE') {
    if (!authResult || authResult.userId !== episode.userId) {
      return errorResponse('Not found', 404);
    }
  }

  // Per-user fields fetched separately (cheap, not cached)
  let isSaved = false;

  if (authResult) {
    const save = await prisma.save.findUnique({
      where: { userId_episodeId: { userId: authResult.userId, episodeId } },
    });
    isSaved = !!save;
  }

  // Resolve audio URLs: presigned for PRIVATE/UNLISTED, public CDN for PUBLIC
  const [resolvedAudioUrl, resolvedSegments] = await Promise.all([
    resolveAudioUrl(episode.audioUrl, episode.visibility),
    Promise.all(
      episode.segments.map(async (s: Record<string, unknown>) => ({
        ...s,
        audioUrl: await resolveAudioUrl(s.audioUrl as string | null, episode.visibility),
      }))
    ),
  ]);

  // Owner-only fields: fetch separately (cheap, not cached) so the shared
  // public cache never leaks failure details to non-owners.
  let failureReason: string | null = null;
  if (authResult && authResult.userId === episode.userId && episode.status === 'FAILED') {
    const ownerFields = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: { failureReason: true },
    });
    failureReason = ownerFields?.failureReason ?? null;
  }

  return NextResponse.json({
    ...episode,
    audioUrl: resolvedAudioUrl,
    segments: resolvedSegments,
    isSaved,
    ...(failureReason ? { failureReason } : {}),
  });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { userId: true },
  });

  if (!episode) {
    return errorResponse('Episode not found', 404);
  }

  if (episode.userId !== authResult.userId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = updateEpisodeSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const updateData = parsed.data;

  // Regenerate slug when title changes
  const slugData = updateData.title
    ? { slug: await generateEpisodeSlug(updateData.title, authResult.userId, prisma) }
    : {};

  const updated = await prisma.episode.update({
    where: { id: episodeId },
    data: {
      ...updateData,
      ...slugData,
    },
    select: {
      ...EPISODE_PUBLIC_SELECT,
      user: { select: { id: true, name: true, handle: true, image: true } },
      tags: { include: { tag: true } },
    },
  });
  await invalidateEpisodeCache(episodeId);

  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { userId: true },
  });

  if (!episode) {
    return errorResponse('Episode not found', 404);
  }

  if (episode.userId !== authResult.userId) {
    return errorResponse('Forbidden', 403);
  }

  await prismaUnfiltered.episode.update({
    where: { id: episodeId },
    data: { deletedAt: new Date() },
  });
  await invalidateEpisodeCache(episodeId);

  return new NextResponse(null, { status: 204 });
}
