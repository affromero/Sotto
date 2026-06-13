import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
/**
 * GET /api/saved — User's saved (bookmarked) episodes.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const saves = await prisma.save.findMany({
    where: { userId: session.user.id, episode: { deletedAt: null } },
    orderBy: { createdAt: 'desc' },
    include: {
      episode: {
        select: {
          id: true,
          title: true,
          topic: true,
          status: true,
          visibility: true,
          audioUrl: true,
          duration: true,
          createdAt: true,
          source: true,
          sourcePlatform: true,
          language: true,
          user: { select: { id: true, name: true, handle: true, image: true } },
          tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
        },
      },
    },
  });

  const episodes = saves.map((save) => ({
    ...save.episode,
    createdAt: save.episode.createdAt.toISOString(),
    tags: save.episode.tags.map(
      (pt: { tag: { id: string; name: string; slug: string } }) => pt.tag
    ),
  }));

  return NextResponse.json({ episodes });
}
