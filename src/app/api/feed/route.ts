import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { feedQuerySchema } from '@/lib/validations';

export async function GET(request: NextRequest) {
  const searchParams = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = feedQuerySchema.safeParse(searchParams);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { page, limit, search, tag, sort } = parsed.data;
  const skip = (page - 1) * limit;

  const where = {
    status: 'READY' as const,
    visibility: 'PUBLIC' as const,
    ...(search && {
      OR: [
        { title: { contains: search, mode: 'insensitive' as const } },
        { topic: { contains: search, mode: 'insensitive' as const } },
      ],
    }),
    ...(tag && {
      tags: { some: { tag: { slug: tag } } },
    }),
  };

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
