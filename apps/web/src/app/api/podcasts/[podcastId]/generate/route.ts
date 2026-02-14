import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { contentExtractionQueue, addJob, JobType } from '@/lib/queue';
import { LIMITS } from '@/lib/stripe';
import { canResolveAi } from '@/lib/providers/ai';
import { checkRateLimit } from '@/lib/redis';
import type { ExtractContentPayload } from '@/lib/queue';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit: 20/hour, 100/day
  const hourly = await checkRateLimit(`generate:hour:${authResult.userId}`, 20, 3600);
  if (!hourly.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded: max 20 generations per hour.' },
      { status: 429 }
    );
  }
  const daily = await checkRateLimit(`generate:day:${authResult.userId}`, 100, 86400);
  if (!daily.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded: max 100 generations per day.' },
      { status: 429 }
    );
  }

  // BYOK check: ensure AI provider is configured
  const hasAi = await canResolveAi(authResult.userId);
  if (!hasAi) {
    return NextResponse.json(
      { error: 'AI provider not configured. Add an API key in Settings.' },
      { status: 403 }
    );
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

  // Duration validation
  const durationTarget = podcast.discovery?.durationTarget;
  if (durationTarget && durationTarget > LIMITS.maxDurationMinutes) {
    return NextResponse.json(
      {
        error: `Requested duration (${durationTarget} min) exceeds the maximum of ${LIMITS.maxDurationMinutes} minutes.`,
      },
      { status: 400 }
    );
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
