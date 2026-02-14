import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { createPodcastSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/redis';
import { contentExtractionQueue, addJob, JobType } from '@/lib/queue';
import { canResolveAi } from '@/lib/providers/ai';
import { LIMITS } from '@/lib/stripe';
import type { ExtractContentPayload } from '@/lib/queue';

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const podcasts = await prisma.podcast.findMany({
    where: { userId: authResult.userId },
    orderBy: { createdAt: 'desc' },
    include: {
      tags: { include: { tag: true } },
    },
  });

  return NextResponse.json(podcasts);
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit API key requests (60 requests per minute)
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const rateLimit = await checkRateLimit(`api:create:${authResult.userId}`, 60, 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', resetAt: rateLimit.resetAt },
        { status: 429 }
      );
    }
  }

  const body = await request.json();
  const parsed = createPodcastSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
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

  // Duration validation
  const durationTarget = parsed.data.metadata?.durationTarget;
  if (durationTarget && durationTarget > LIMITS.maxDurationMinutes) {
    return NextResponse.json(
      {
        error: `Requested duration (${durationTarget} min) exceeds the maximum of ${LIMITS.maxDurationMinutes} minutes.`,
      },
      { status: 400 }
    );
  }

  const podcast = await prisma.podcast.create({
    data: {
      userId: authResult.userId,
      title: parsed.data.title,
      topic: parsed.data.topic,
      status: 'EXTRACTING',
      hostVoiceId: parsed.data.hostVoiceId,
      expertVoiceId: parsed.data.expertVoiceId,
      ttsProvider: parsed.data.ttsProvider ?? null,
    },
  });

  // Create Discovery record from metadata
  if (parsed.data.metadata) {
    const meta = parsed.data.metadata;
    await prisma.discovery.create({
      data: {
        podcastId: podcast.id,
        userId: authResult.userId,
        topic: meta.topic,
        depth: meta.depth,
        audienceLevel: meta.audienceLevel,
        audience: meta.audience,
        focusAreas: meta.focusAreas ?? [],
        tone: meta.tone,
        durationTarget: meta.durationTarget,
        sourceUrl: meta.sourceUrl,
        sourceContent: meta.sourceContent,
      },
    });
  } else {
    // Create a minimal Discovery record so the pipeline can find it
    await prisma.discovery.create({
      data: {
        podcastId: podcast.id,
        userId: authResult.userId,
        topic: parsed.data.topic,
      },
    });
  }

  // Queue content extraction job to kick off the pipeline
  const sourceUrl = parsed.data.metadata?.sourceUrl;
  const sourceText = parsed.data.metadata?.sourceContent;
  const payload: ExtractContentPayload = {
    podcastId: podcast.id,
    userId: authResult.userId,
    sourceUrl: sourceUrl ?? undefined,
    sourceText: sourceText ?? undefined,
  };
  await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload);

  // Fire-and-forget activity record
  prisma.activity.create({
    data: {
      userId: authResult.userId,
      type: 'PODCAST_CREATED',
      targetId: podcast.id,
      targetType: 'podcast',
    },
  }).catch(() => {});

  return NextResponse.json({ id: podcast.id, status: podcast.status }, { status: 201 });
}
