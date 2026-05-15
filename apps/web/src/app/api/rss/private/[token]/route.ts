import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api-response';
import { generatePrivateRssFeed } from '@/lib/rss';

type RouteParams = { params: Promise<{ token: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { token } = await params;
  const xml = await generatePrivateRssFeed(token);

  if (!xml) {
    return errorResponse('Feed not found', 404);
  }

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
    },
  });
}
