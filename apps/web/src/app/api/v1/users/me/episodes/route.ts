import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
/**
 * GET /api/v1/users/me/episodes
 * List the current user's listening lessons, newest first. Backs the mobile
 * library/search/profile tabs.
 */
export async function GET(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }

  const episodes = await prisma.episode.findMany({
    where: { userId: authed.userId },
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { id: true, name: true, handle: true, image: true } },
      tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
    },
  });

  const serialized = episodes.map((p) => ({
    id: p.id,
    title: p.title,
    topic: p.topic,
    status: p.status,
    visibility: p.visibility,
    audioUrl: p.audioUrl,
    duration: p.duration,
    createdAt: p.createdAt.toISOString(),
    source: p.source,
    sourcePlatform: p.sourcePlatform,
    aiProvider: p.aiProvider,
    aiModel: p.aiModel,
    ttsProvider: p.ttsProvider,
    language: p.language,
    aiAutoResolved: p.aiAutoResolved,
    ttsAutoResolved: p.ttsAutoResolved,
    user: p.user,
    tags: p.tags.map((pt) => pt.tag),
  }));

  return NextResponse.json({ episodes: serialized });
}
