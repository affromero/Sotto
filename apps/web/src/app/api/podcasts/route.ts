import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { createPodcastSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/redis';

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

  const podcast = await prisma.podcast.create({
    data: {
      userId: authResult.userId,
      title: parsed.data.title,
      topic: parsed.data.topic,
      status: 'PENDING',
      hostVoiceId: parsed.data.hostVoiceId,
      expertVoiceId: parsed.data.expertVoiceId,
      ttsProvider: parsed.data.ttsProvider ?? null,
    },
  });

  return NextResponse.json(podcast, { status: 201 });
}
