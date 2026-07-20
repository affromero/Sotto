import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) return errorResponse('Unauthorized', 401);

  // Return only top-level tags (no parent) for feed filtering
  const tags = await prisma.tag.findMany({
    where: { parentId: null },
    select: {
      id: true,
      name: true,
      slug: true,
      _count: {
        select: { episodes: { where: { episode: { deletedAt: null } } } },
      },
    },
    orderBy: {
      episodes: { _count: 'desc' },
    },
  });

  const result = tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    episodeCount: tag._count.episodes,
  }));

  return NextResponse.json(result);
}
