import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { interactionSchema } from '@/lib/validations';
import { interactionQueue, addJob, JobType } from '@/lib/queue';
import { checkRateLimit } from '@/lib/redis';
import { checkSuspension } from '@/lib/auth-guards';
import { getTierFeatures } from '@/lib/tier-features';
import { hasByokKey } from '@/lib/byok';
import type { ProcessInteractionPayload } from '@/lib/queue';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const suspended = checkSuspension(session);
  if (suspended) return suspended;

  // Rate limit: 60/hour
  const hourly = await checkRateLimit(`interact:hour:${session.user.id}`, 60, 3600);
  if (!hourly.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded: max 60 interactions per hour.' },
      { status: 429 }
    );
  }

  // Check Q&A interaction limit based on tier
  const [user, isByok] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { plan: true, role: true },
    }),
    hasByokKey(session.user.id),
  ]);
  const tierFeatures = getTierFeatures(user.plan as 'FREE' | 'PRO', isByok, user.role);

  if (isFinite(tierFeatures.maxQaInteractions)) {
    const existingCount = await prisma.interaction.count({
      where: { userId: session.user.id, podcastId },
    });
    if (existingCount >= tierFeatures.maxQaInteractions) {
      return NextResponse.json(
        { error: `Q&A limit reached (${tierFeatures.maxQaInteractions} per podcast). Upgrade to Pro for unlimited Q&A.` },
        { status: 403 }
      );
    }
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
