import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: {
      title: true,
      audioUrl: true,
      status: true,
      visibility: true,
    },
  });

  if (!podcast || podcast.status !== 'READY' || !podcast.audioUrl) {
    return NextResponse.json({ error: 'Podcast not found or not ready' }, { status: 404 });
  }

  if (podcast.visibility === 'PRIVATE') {
    return NextResponse.json({ error: 'This podcast is private' }, { status: 403 });
  }

  // Fetch audio from R2/storage and stream with Content-Disposition
  try {
    const audioResponse = await fetch(podcast.audioUrl);
    if (!audioResponse.ok || !audioResponse.body) {
      return NextResponse.json({ error: 'Audio file not available' }, { status: 502 });
    }

    const sanitizedTitle = podcast.title.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'podcast';

    return new NextResponse(audioResponse.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': `attachment; filename="${sanitizedTitle}.mp3"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch audio' }, { status: 502 });
  }
}
