import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { interactionSchema } from '@/lib/validations';
import { interactionQueue, addJob, JobType } from '@/lib/queue';
import { checkRateLimit } from '@/lib/redis';
import { checkSuspension } from '@/lib/auth-guards';
import { getTierFeatures } from '@/lib/tier-features';
import { hasByokKey } from '@/lib/byok';
import type { ProcessInteractionPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  // Session-based suspension check (skip for API key auth)
  const authHeader = request.headers.get('authorization');
  const isApiKeyAuth = authHeader?.startsWith('Bearer ');
  if (!isApiKeyAuth) {
    const { auth } = await import('@/lib/auth');
    const session = await auth();
    if (session) {
      const suspended = checkSuspension(session);
      if (suspended) return suspended;
    }
  }

  // Rate limit: 60/hour
  const hourly = await checkRateLimit(`interact:hour:${authResult.userId}`, 60, 3600);
  if (!hourly.allowed) {
    return errorResponse('Rate limit exceeded: max 60 interactions per hour.', 429);
  }

  // Check Q&A interaction limit based on tier
  const [user, isByok] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: authResult.userId },
      select: { plan: true, role: true },
    }),
    hasByokKey(authResult.userId),
  ]);
  const tierFeatures = getTierFeatures(user.plan as 'FREE' | 'PRO', isByok, user.role);

  if (isFinite(tierFeatures.maxQaInteractions)) {
    const existingCount = await prisma.interaction.count({
      where: { userId: authResult.userId, podcastId },
    });
    if (existingCount >= tierFeatures.maxQaInteractions) {
      return errorResponse(`Q&A limit reached (${tierFeatures.maxQaInteractions} per podcast). Upgrade to Pro for unlimited Q&A.`, 403);
    }
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  const body = await request.json();
  const parsed = interactionSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { question, timestamp } = parsed.data;

  // Create interaction record
  const interaction = await prisma.interaction.create({
    data: {
      podcastId,
      userId: authResult.userId,
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
    userId: authResult.userId,
    question,
    timestamp,
  };

  await addJob(interactionQueue, JobType.PROCESS_INTERACTION, payload);

  return NextResponse.json(interaction, { status: 201 });
}
