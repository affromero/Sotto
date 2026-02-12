import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  // Parse podcast ID from URL: .../podcast/{id}
  const match = url.match(/\/podcast\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    return NextResponse.json({ error: 'Invalid podcast URL' }, { status: 400 });
  }

  const podcastId = match[1];
  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: {
      id: true,
      title: true,
      status: true,
      visibility: true,
      user: { select: { name: true } },
    },
  });

  if (!podcast || podcast.status !== 'READY' || podcast.visibility === 'PRIVATE') {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://sotto.fm';
  const embedUrl = `${appUrl}/podcast/${podcastId}/embed`;

  const oembedResponse = {
    version: '1.0',
    type: 'rich',
    provider_name: 'Sotto',
    provider_url: appUrl,
    title: podcast.title,
    author_name: podcast.user.name || 'Anonymous',
    author_url: `${appUrl}/profile/${podcast.user.name}`,
    html: `<iframe src="${embedUrl}" width="100%" height="160" frameborder="0" allow="autoplay" loading="lazy" style="border-radius:12px;max-width:600px"></iframe>`,
    width: 600,
    height: 160,
  };

  return NextResponse.json(oembedResponse, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
