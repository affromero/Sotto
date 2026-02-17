import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(_request: NextRequest) {
  // Return only top-level tags (no parent) for feed filtering
  const tags = await prisma.tag.findMany({
    where: { parentId: null },
    select: {
      id: true,
      name: true,
      slug: true,
      _count: {
        select: { podcasts: { where: { podcast: { deletedAt: null } } } },
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
