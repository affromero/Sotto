import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { interactionSchema } from '@/lib/validations';
import { interactionQueue, addJob, JobType } from '@/lib/queue';
import type { ProcessInteractionPayload } from '@/lib/queue';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  const body = await request.json();
  const parsed = interactionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { question, timestamp } = parsed.data;

  // Create interaction record
  const interaction = await prisma.interaction.create({
    data: {
      podcastId,
      userId: session.user.id,
      question,
      timestamp,
      status: 'PENDING',
    },
    include: {
      user: { select: { id: true, name: true, image: true } },
    },
  });

  // Queue interaction processing job
  const payload: ProcessInteractionPayload = {
    podcastId,
    interactionId: interaction.id,
    userId: session.user.id,
    question,
    timestamp,
  };

  await addJob(interactionQueue, JobType.PROCESS_INTERACTION, payload);

  return NextResponse.json(interaction, { status: 201 });
}
