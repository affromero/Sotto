import { NextRequest, NextResponse } from 'next/server';
import { generateCreatorRssFeed } from '@/lib/rss';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ userId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { userId } = await params;

  const xml = await generateCreatorRssFeed(userId);

  if (!xml) {
    return errorResponse('User not found', 404);
  }

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=900, s-maxage=3600',
    },
  });
}
