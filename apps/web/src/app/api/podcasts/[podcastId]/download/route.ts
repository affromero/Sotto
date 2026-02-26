import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getTierFeatures } from '@/lib/tier-features';
import { hasByokKey } from '@/lib/byok';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Download requires a Pro subscription.', 403);
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: {
      title: true,
      audioUrl: true,
      status: true,
      visibility: true,
      userId: true,
    },
  });

  if (!podcast || podcast.status !== 'READY' || !podcast.audioUrl) {
    return errorResponse('Podcast not found or not ready', 404);
  }

  if (podcast.visibility === 'PRIVATE') {
    return errorResponse('This podcast is private', 403);
  }

  // Owner can always download their own podcasts
  const isOwner = podcast.userId === session.user.id;
  if (!isOwner) {
    const [user, isByok] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: session.user.id },
        select: { plan: true, role: true },
      }),
      hasByokKey(session.user.id),
    ]);
    const features = getTierFeatures(user.plan as 'FREE' | 'PRO', isByok, user.role);
    if (!features.downloadAllowed) {
      return errorResponse('Download requires a Pro subscription.', 403);
    }
  }

  // Support ?track=<voiceTrackId> to download a specific voice track
  let audioUrl = podcast.audioUrl;
  let titleSuffix = '';
  const trackId = request.nextUrl.searchParams.get('track');
  if (trackId) {
    const track = await prisma.voiceTrack.findUnique({
      where: { id: trackId },
      select: { podcastId: true, status: true, audioUrl: true, name: true },
    });

    if (!track || track.podcastId !== podcastId || track.status !== 'READY' || !track.audioUrl) {
      return errorResponse('Voice track not found or not ready', 404);
    }

    audioUrl = track.audioUrl;
    titleSuffix = ` - ${track.name}`;
  }

  // Fetch audio from R2/storage and stream with Content-Disposition
  try {
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok || !audioResponse.body) {
      return errorResponse('Audio file not available', 502);
    }

    const sanitizedTitle = (podcast.title + titleSuffix).replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'podcast';

    return new NextResponse(audioResponse.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': `attachment; filename="${sanitizedTitle}.mp3"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return errorResponse('Failed to fetch audio', 502);
  }
}
