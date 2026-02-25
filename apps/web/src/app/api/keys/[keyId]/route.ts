import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ keyId: string }> };

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { keyId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const apiKey = await prisma.apiKey.findUnique({
    where: { id: keyId },
    select: { userId: true, revokedAt: true },
  });

  if (!apiKey) {
    return errorResponse('API key not found', 404);
  }

  if (apiKey.userId !== session.user.id) {
    return errorResponse('Forbidden', 403);
  }

  if (apiKey.revokedAt) {
    return errorResponse('API key already revoked', 400);
  }

  await prisma.apiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
  });

  return new NextResponse(null, { status: 204 });
}
