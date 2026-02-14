import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { contentExtractionQueue, addJob, JobType } from '@/lib/queue';
import { getUserTier } from '@/lib/subscription';
import { TIER_LIMITS, canGenerate } from '@/lib/stripe';
import { consumeCredit } from '@/lib/credits';
import type { ExtractContentPayload } from '@/lib/queue';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    include: {
      discovery: {
        select: { sourceUrl: true, sourceContent: true, durationTarget: true },
      },
    },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  if (podcast.userId !== authResult.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (
    podcast.status !== 'PENDING' &&
    podcast.status !== 'DISCOVERING' &&
    podcast.status !== 'FAILED'
  ) {
    return NextResponse.json(
      { error: 'Podcast must be in PENDING, DISCOVERING, or FAILED status to generate' },
      { status: 400 }
    );
  }

  // Pre-generation duration validation
  const durationTarget = podcast.discovery?.durationTarget;
  const tier = await getUserTier(authResult.userId);
  const maxMinutes = TIER_LIMITS[tier].maxDurationMinutes;

  if (durationTarget && durationTarget > maxMinutes) {
    return NextResponse.json(
      {
        error: `Requested duration (${durationTarget} min) exceeds your plan's limit of ${maxMinutes} minutes. Reduce duration or upgrade your plan.`,
      },
      { status: 400 }
    );
  }

  // Detect shared voices (voice clones owned by other users)
  const voiceIdsToCheck = [podcast.hostVoiceId, podcast.expertVoiceId].filter(
    (id): id is string => !!id
  );
  let sharedVoiceCount = 0;
  if (voiceIdsToCheck.length > 0) {
    const foreignClones = await prisma.voiceClone.findMany({
      where: {
        elevenLabsVoiceId: { in: voiceIdsToCheck },
        userId: { not: authResult.userId },
      },
      select: { elevenLabsVoiceId: true },
    });
    sharedVoiceCount = foreignClones.length;
  }

  // Check credit balance and consume credits
  const subscription = await prisma.subscription.findUnique({
    where: { userId: authResult.userId },
    select: { creditsBalance: true },
  });
  const creditsBalance = subscription?.creditsBalance ?? 0;
  const user = await prisma.user.findUnique({
    where: { id: authResult.userId },
    select: { role: true },
  });

  const check = canGenerate(
    creditsBalance,
    podcast.usePremiumVoice,
    tier,
    user?.role,
    sharedVoiceCount
  );
  if (!check.allowed) {
    return NextResponse.json({ error: check.reason }, { status: 402 });
  }

  try {
    const sharedNote = sharedVoiceCount > 0 ? ` + ${sharedVoiceCount} shared voice surcharge` : '';
    await consumeCredit(
      authResult.userId,
      check.cost,
      `Podcast generation${podcast.usePremiumVoice ? ' (premium voice)' : ''}${sharedNote}`,
      podcastId
    );
  } catch {
    return NextResponse.json(
      { error: 'Insufficient credits to generate this podcast.' },
      { status: 402 }
    );
  }

  // Store credit cost on podcast for accurate refunds
  await prisma.podcast.update({
    where: { id: podcastId },
    data: { creditCost: check.cost },
  });

  // For FAILED podcasts, clean up old failed jobs
  if (podcast.status === 'FAILED') {
    await prisma.job.updateMany({
      where: { podcastId, status: 'failed' },
      data: { status: 'superseded' },
    });
  }

  // Update status to EXTRACTING
  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'EXTRACTING' },
  });

  // Queue content extraction job
  const payload: ExtractContentPayload = {
    podcastId,
    userId: authResult.userId,
    sourceUrl: podcast.discovery?.sourceUrl ?? undefined,
    sourceText: podcast.discovery?.sourceContent ?? undefined,
  };

  await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload);

  return NextResponse.json({ success: true, message: 'Generation started' });
}
