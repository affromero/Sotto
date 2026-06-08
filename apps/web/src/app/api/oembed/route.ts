import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAppBaseUrl } from '@/lib/urls';

import { errorResponse } from '@/lib/api-response';
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return errorResponse('Missing url parameter', 400);
  }

  const appUrl = getAppBaseUrl();
  let requestedUrl: URL;
  try {
    requestedUrl = new URL(url);
  } catch {
    return errorResponse('Invalid podcast URL', 400);
  }

  if (requestedUrl.origin !== new URL(appUrl).origin) {
    return errorResponse('Invalid podcast URL', 400);
  }

  // Parse podcast ID from URL: .../podcast/{id}
  const match = requestedUrl.pathname.match(/^\/podcast\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    return errorResponse('Invalid podcast URL', 400);
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
    return errorResponse('Podcast not found', 404);
  }

  const embedUrl = `${appUrl}/podcast/${podcastId}/embed`;

  const oembedResponse = {
    version: '1.0',
    type: 'rich',
    provider_name: 'Sotto',
    provider_url: appUrl,
    title: podcast.title,
    author_name: podcast.user.name || 'Anonymous',
    thumbnail_url: `${appUrl}/podcast/${podcastId}/opengraph-image`,
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
