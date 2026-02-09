import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { feedQuerySchema } from '@/lib/validations';
import { searchPodcasts, getTrending } from '@/lib/recommendation-engine';
import type { Prisma } from '@prisma/client';

/**
 * GET /api/feed
 * Modes:
 * - trending: 6 results, no auth required
 * - explore: max 10 results with search/filters, optional auth for personalization
 * - following: from followed creators, auth required
 * - (default): recent podcasts for backward compatibility
 */
export async function GET(request: NextRequest) {
  const searchParams = Object.fromEntries(request.nextUrl.searchParams);
  const mode = searchParams.mode;

  // Mode: trending — 6 results, no auth
  if (mode === 'trending') {
    const trending = await getTrending();
    return NextResponse.json({ podcasts: trending, total: trending.length });
  }

  // Mode: explore — max 10 with search/filters, optional auth
  if (mode === 'explore') {
    const session = await auth().catch(() => null);
    const query = searchParams.query || searchParams.search || '';
    const results = await searchPodcasts(
      query,
      {
        tag: searchParams.tag,
        depth: searchParams.depth,
        audience: searchParams.audience,
        tone: searchParams.tone,
      },
      session?.user?.id
    );
    return NextResponse.json({ podcasts: results, total: results.length });
  }

  // Mode: following — from followed creators, auth required
  if (mode === 'following') {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const followedIds = await prisma.follow.findMany({
      where: { followerId: session.user.id },
      select: { followingId: true },
    });

    const podcasts = await prisma.podcast.findMany({
      where: {
        status: 'READY',
        visibility: 'PUBLIC',
        userId: { in: followedIds.map((f) => f.followingId) },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        user: { select: { id: true, name: true, image: true } },
        tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
      },
    });

    const serialized = podcasts.map((p) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      tags: p.tags.map((pt) => pt.tag),
    }));

    return NextResponse.json({ podcasts: serialized, total: serialized.length });
  }

  // Default mode: full feed with filters (backward compatible)
  const parsed = feedQuerySchema.safeParse(searchParams);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const {
    page,
    limit,
    search,
    tag,
    sort,
    tags,
    depth,
    audience,
    tone,
    durationMin,
    durationMax,
    dateFrom,
    dateTo,
  } = parsed.data;
  const skip = (page - 1) * limit;

  const where: Prisma.PodcastWhereInput = {
    status: 'READY',
    visibility: 'PUBLIC',
  };

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { topic: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (tag) {
    where.tags = { some: { tag: { slug: tag } } };
  }

  if (tags) {
    const tagSlugs = tags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (tagSlugs.length > 0) {
      where.AND = tagSlugs.map((slug) => ({
        tags: { some: { tag: { slug } } },
      }));
    }
  }

  if (depth || audience || tone) {
    const discoveryFilter: Prisma.DiscoveryWhereInput = {};
    if (depth) discoveryFilter.depth = depth;
    if (audience) discoveryFilter.audienceLevel = audience;
    if (tone) discoveryFilter.tone = tone;
    where.discovery = discoveryFilter;
  }

  if (durationMin !== undefined || durationMax !== undefined) {
    const durationFilter: Prisma.IntNullableFilter = {};
    if (durationMin !== undefined) durationFilter.gte = durationMin * 60;
    if (durationMax !== undefined) durationFilter.lte = durationMax * 60;
    where.duration = durationFilter;
  }

  if (dateFrom || dateTo) {
    const dateFilter: Prisma.DateTimeFilter = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) dateFilter.lte = new Date(dateTo);
    where.createdAt = dateFilter;
  }

  const orderBy =
    sort === 'popular'
      ? { playCount: 'desc' as const }
      : sort === 'trending'
        ? { likeCount: 'desc' as const }
        : { createdAt: 'desc' as const };

  const [podcasts, total] = await Promise.all([
    prisma.podcast.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        user: { select: { id: true, name: true, image: true } },
        tags: { include: { tag: true } },
      },
    }),
    prisma.podcast.count({ where }),
  ]);

  return NextResponse.json({
    podcasts,
    total,
    page,
    limit,
    hasMore: skip + limit < total,
  });
}
