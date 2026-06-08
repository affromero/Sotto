import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';

type RouteParams = { params: Promise<{ tokenId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const { tokenId } = await params;
  const token = await prisma.privateFeedToken.findFirst({
    where: { id: tokenId, userId: authResult.userId, revokedAt: null },
    select: { id: true },
  });

  if (!token) {
    return errorResponse('Feed token not found', 404);
  }

  await prisma.privateFeedToken.update({
    where: { id: token.id },
    data: { revokedAt: new Date() },
  });

  return new NextResponse(null, { status: 204 });
}
