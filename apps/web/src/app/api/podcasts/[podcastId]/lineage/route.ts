import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: {
      id: true,
      title: true,
      forkedFromId: true,
      user: { select: { id: true, name: true, handle: true, image: true } },
    },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  // Walk up the ancestor chain (max 10 levels to prevent runaway)
  const ancestors: Array<{
    id: string;
    title: string;
    user: { id: string; name: string | null; handle: string | null; image: string | null };
  }> = [];

  let currentId = podcast.forkedFromId;
  let depth = 0;
  while (currentId && depth < 10) {
    const ancestor = await prisma.podcast.findUnique({
      where: { id: currentId },
      select: {
        id: true,
        title: true,
        forkedFromId: true,
        user: { select: { id: true, name: true, handle: true, image: true } },
      },
    });
    if (!ancestor) break;
    ancestors.unshift({ id: ancestor.id, title: ancestor.title, user: ancestor.user });
    currentId = ancestor.forkedFromId;
    depth++;
  }

  // Get direct descendants (forks of this podcast, max 20)
  const forks = await prisma.podcast.findMany({
    where: { forkedFromId: podcastId, visibility: 'PUBLIC' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      title: true,
      remixNote: true,
      createdAt: true,
      user: { select: { id: true, name: true, handle: true, image: true } },
    },
  });

  return NextResponse.json({ ancestors, forks });
}
