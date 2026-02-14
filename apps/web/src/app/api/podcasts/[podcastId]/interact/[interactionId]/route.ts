import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type RouteParams = { params: Promise<{ podcastId: string; interactionId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { interactionId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const interaction = await prisma.interaction.findUnique({
    where: { id: interactionId },
    select: {
      id: true,
      question: true,
      timestamp: true,
      status: true,
      answer: true,
      helpful: true,
      segmentOrder: true,
    },
  });

  if (!interaction) {
    return NextResponse.json({ error: 'Interaction not found' }, { status: 404 });
  }

  return NextResponse.json(interaction);
}
