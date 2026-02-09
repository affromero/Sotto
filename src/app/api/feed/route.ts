import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { feedQuerySchema } from '@/lib/validations';
import type { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  const searchParams = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = feedQuerySchema.safeParse(searchParams);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { page, limit, search, tag, sort, tags, depth, audience, tone, durationMin, durationMax, dateFrom, dateTo } = parsed.data;
  const skip = (page - 1) * limit;

  const where: Prisma.PodcastWhereInput = {
    status: 'READY',
    visibility: 'PUBLIC',
  };

  // Text search
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { topic: { contains: search, mode: 'insensitive' } },
    ];
  }

  // Single tag filter (backward compatible)
  if (tag) {
    where.tags = { some: { tag: { slug: tag } } };
  }

  // Multi-tag filter (comma-separated)
  if (tags) {
    const tagSlugs = tags.split(',').map((s) => s.trim()).filter(Boolean);
    if (tagSlugs.length > 0) {
      where.AND = tagSlugs.map((slug) => ({
        tags: { some: { tag: { slug } } },
      }));
    }
  }

  // Discovery metadata filters
  if (depth || audience || tone) {
    const discoveryFilter: Prisma.DiscoveryWhereInput = {};
    if (depth) discoveryFilter.depth = depth;
    if (audience) discoveryFilter.audienceLevel = audience;
    if (tone) discoveryFilter.tone = tone;
    where.discovery = discoveryFilter;
  }

  // Duration range (convert minutes to seconds)
  if (durationMin !== undefined || durationMax !== undefined) {
    const durationFilter: Prisma.IntNullableFilter = {};
    if (durationMin !== undefined) durationFilter.gte = durationMin * 60;
    if (durationMax !== undefined) durationFilter.lte = durationMax * 60;
    where.duration = durationFilter;
  }

  // Date range
  if (dateFrom || dateTo) {
    const dateFilter: Prisma.DateTimeFilter = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) dateFilter.lte = new Date(dateTo);
    where.createdAt = dateFilter;
  }

  const orderBy = sort === 'popular'
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
