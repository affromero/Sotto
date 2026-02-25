import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateCreatorRssFeed } from '@/lib/rss';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ handle: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { handle } = await params;

  const user = await prisma.user.findUnique({
    where: { handle },
    select: { id: true },
  });

  if (!user) {
    return errorResponse('User not found', 404);
  }

  const xml = await generateCreatorRssFeed(user.id);

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
