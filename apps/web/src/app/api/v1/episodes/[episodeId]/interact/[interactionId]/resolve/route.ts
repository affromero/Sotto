import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveInteractionSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ episodeId: string; interactionId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { interactionId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = resolveInteractionSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const interaction = await prisma.interaction.findUnique({
    where: { id: interactionId },
    select: { userId: true, status: true },
  });

  if (!interaction) {
    return errorResponse('Interaction not found', 404);
  }

  if (interaction.userId !== session.user.id) {
    return errorResponse('Forbidden', 403);
  }

  if (interaction.status !== 'ANSWERED') {
    return errorResponse('Interaction must be in ANSWERED status to resolve', 400);
  }

  const updated = await prisma.interaction.update({
    where: { id: interactionId },
    data: {
      status: 'RESOLVED',
      resolved: true,
      helpful: parsed.data.helpful,
    },
  });

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    helpful: updated.helpful,
  });
}
