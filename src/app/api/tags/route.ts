import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(_request: NextRequest) {
  const tags = await prisma.tag.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      _count: {
        select: { podcasts: true },
      },
    },
    orderBy: {
      podcasts: { _count: 'desc' },
    },
  });

  const result = tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    podcastCount: tag._count.podcasts,
  }));

  return NextResponse.json(result);
}
