import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { isUserAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ keyId: string }> };

// Bearer-capable: revoking is the one key operation a paired device should be
// able to do, including revoking itself if it is lost.
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { keyId } = await params;
  const authed = await authenticateRequest(request);

  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }
  if (!(await isUserAdmin(authed.userId))) {
    return errorResponse('Forbidden', 403);
  }

  const apiKey = await prisma.apiKey.findUnique({
    where: { id: keyId },
    select: { userId: true, revokedAt: true },
  });

  if (!apiKey) {
    return errorResponse('API key not found', 404);
  }

  if (apiKey.userId !== authed.userId) {
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
