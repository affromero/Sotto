import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
/**
 * GET /api/saved — User's saved (bookmarked) podcasts.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const saves = await prisma.save.findMany({
    where: { userId: session.user.id, podcast: { deletedAt: null } },
    orderBy: { createdAt: 'desc' },
    include: {
      podcast: {
        select: {
          id: true,
          title: true,
          topic: true,
          status: true,
          visibility: true,
          audioUrl: true,
          duration: true,
          playCount: true,
          likeCount: true,
          forkCount: true,
          createdAt: true,
          source: true,
          isHumanContent: true,
          sourcePlatform: true,
          aiProvider: true,
          aiModel: true,
          ttsProvider: true,
          ttsModel: true,
          language: true,
          forkedFromId: true,
          user: { select: { id: true, name: true, handle: true, image: true, role: true } },
          tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
        },
      },
    },
  });

  const podcasts = saves.map((save) => ({
    ...save.podcast,
    createdAt: save.podcast.createdAt.toISOString(),
    tags: save.podcast.tags.map(
      (pt: { tag: { id: string; name: string; slug: string } }) => pt.tag
    ),
  }));

  return NextResponse.json({ podcasts });
}
