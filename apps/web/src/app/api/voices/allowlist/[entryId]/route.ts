import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ entryId: string }> };

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { entryId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  // Fetch entry and verify voice clone ownership
  const entry = await prisma.voiceAllowlist.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      voiceClone: { select: { userId: true } },
    },
  });

  if (!entry) {
    return errorResponse('Allowlist entry not found', 404);
  }

  if (entry.voiceClone.userId !== session.user.id) {
    return errorResponse('Forbidden', 403);
  }

  await prisma.voiceAllowlist.delete({
    where: { id: entryId },
  });

  return NextResponse.json({ success: true });
}
