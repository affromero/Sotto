import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveInteractionSchema } from '@/lib/validations';

type RouteParams = { params: Promise<{ podcastId: string; interactionId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { interactionId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = resolveInteractionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const interaction = await prisma.interaction.findUnique({
    where: { id: interactionId },
    select: { userId: true, status: true },
  });

  if (!interaction) {
    return NextResponse.json({ error: 'Interaction not found' }, { status: 404 });
  }

  if (interaction.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (interaction.status !== 'ANSWERED') {
    return NextResponse.json(
      { error: 'Interaction must be in ANSWERED status to resolve' },
      { status: 400 }
    );
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
