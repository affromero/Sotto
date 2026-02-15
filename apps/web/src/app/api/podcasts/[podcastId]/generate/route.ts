import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { contentExtractionQueue, audioImportQueue, addJob, JobType } from '@/lib/queue';
import { LIMITS } from '@/lib/stripe';
import { canResolveAi } from '@/lib/providers/ai';
import { checkRateLimit } from '@/lib/redis';
import { getAiKey, getByokKey } from '@/lib/byok';
import type { ExtractContentPayload, ImportAudioPayload } from '@/lib/queue';
import type { SttProviderId } from '@sotto/shared';

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
    select: {
      id: true,
      userId: true,
      status: true,
      source: true,
      importedAudioKey: true,
      isHumanContent: true,
      title: true,
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

    // Clean up data from previous failed attempt
    await prisma.podcastVersionSegment.deleteMany({
      where: { version: { podcastId } },
    });
    await prisma.podcastVersion.deleteMany({ where: { podcastId } });
    await prisma.segment.deleteMany({ where: { podcastId } });
    await prisma.script.deleteMany({ where: { podcastId } });
  }

  // Imported podcasts re-queue the import pipeline
  if (podcast.source === 'IMPORT' && podcast.importedAudioKey) {
    // Resolve STT key — try groq first, then openai, then elevenlabs
    let sttProvider: SttProviderId | undefined;
    let sttApiKey: string | undefined;

    const groqKey = await getAiKey(authResult.userId, 'groq');
    if (groqKey?.apiKey || process.env.GROQ_API_KEY) {
      sttProvider = 'groq';
      sttApiKey = groqKey?.apiKey ?? process.env.GROQ_API_KEY;
    } else {
      const openaiKey = await getAiKey(authResult.userId, 'openai');
      if (openaiKey?.apiKey || process.env.OPENAI_API_KEY) {
        sttProvider = 'openai';
        sttApiKey = openaiKey?.apiKey ?? process.env.OPENAI_API_KEY;
      } else {
        const elKey = await getByokKey(authResult.userId, 'elevenlabs');
        if (elKey || process.env.ELEVENLABS_API_KEY) {
          sttProvider = 'elevenlabs';
          sttApiKey = elKey ?? process.env.ELEVENLABS_API_KEY;
        }
      }
    }

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'IMPORTING' },
    });

    const importPayload: ImportAudioPayload = {
      podcastId,
      userId: authResult.userId,
      audioKey: podcast.importedAudioKey,
      isHumanContent: podcast.isHumanContent,
      generateMetadata: !podcast.title || podcast.title === 'Untitled Import',
      sttProvider,
      sttApiKey,
    };

    await addJob(audioImportQueue, JobType.IMPORT_AUDIO, importPayload);

    return NextResponse.json({ success: true, message: 'Import retry started' });
  }

  // Standard generation pipeline
  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'EXTRACTING' },
  });

  const payload: ExtractContentPayload = {
    podcastId,
    userId: authResult.userId,
    sourceUrl: podcast.discovery?.sourceUrl ?? undefined,
    sourceText: podcast.discovery?.sourceContent ?? undefined,
  };

  await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload);

  return NextResponse.json({ success: true, message: 'Generation started' });
}
