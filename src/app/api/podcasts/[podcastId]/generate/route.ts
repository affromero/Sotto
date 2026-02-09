import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { contentExtractionQueue, addJob, JobType } from '@/lib/queue';
import { consumeVoiceCredit, getUserTier } from '@/lib/subscription';
import { TIER_LIMITS } from '@/lib/stripe';
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
  if (durationTarget) {
    const tier = await getUserTier(authResult.userId);
    const maxMinutes = TIER_LIMITS[tier].maxDurationMinutes;
    if (durationTarget > maxMinutes) {
      return NextResponse.json(
        {
          error: `Requested duration (${durationTarget} min) exceeds your plan's limit of ${maxMinutes} minutes. Reduce duration or upgrade your plan.`,
        },
        { status: 400 }
      );
    }
  }

  // If using premium voice, consume a credit before generation
  if (podcast.usePremiumVoice) {
    try {
      await consumeVoiceCredit(authResult.userId);
    } catch {
      return NextResponse.json(
        {
          error:
            'No premium voice credits remaining. Switch to standard voices or upgrade your plan.',
        },
        { status: 402 }
      );
    }
  }

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
