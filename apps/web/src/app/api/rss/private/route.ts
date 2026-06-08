import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { createPrivateFeedToken } from '@/lib/rss';

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const tokens = await prisma.privateFeedToken.findMany({
    where: { userId: authResult.userId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      feedType: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json(tokens);
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json().catch(() => ({}));
  const rawName = typeof body.name === 'string' ? body.name.trim() : '';
  const name = rawName ? rawName.slice(0, 100) : 'Private Sotto Feed';
  const token = await createPrivateFeedToken(authResult.userId, name);

  return NextResponse.json(token, { status: 201 });
}
