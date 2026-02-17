import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/users/me/podcasts
 * List the current user's podcasts, newest first.
 */
export async function GET(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const podcasts = await prisma.podcast.findMany({
    where: { userId: authed.userId },
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { id: true, name: true, handle: true, image: true } },
      tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
    },
  });

  const serialized = podcasts.map((p) => ({
    id: p.id,
    title: p.title,
    topic: p.topic,
    status: p.status,
    visibility: p.visibility,
    audioUrl: p.audioUrl,
    duration: p.duration,
    playCount: p.playCount,
    likeCount: p.likeCount,
    forkCount: p.forkCount,
    createdAt: p.createdAt.toISOString(),
    source: p.source,
    isHumanContent: p.isHumanContent,
    sourcePlatform: p.sourcePlatform,
    aiProvider: p.aiProvider,
    aiModel: p.aiModel,
    ttsProvider: p.ttsProvider,
    language: p.language,
    forkedFromId: p.forkedFromId,
    user: p.user,
    tags: p.tags.map((pt) => pt.tag),
  }));

  return NextResponse.json({ podcasts: serialized });
}
