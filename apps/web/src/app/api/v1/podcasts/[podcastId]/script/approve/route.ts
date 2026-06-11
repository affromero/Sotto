import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { createSegmentsAndQueueAudio } from '@/lib/segment-creator';
import { convertTurnsForProvider } from '@/lib/tts-tag-converter';
import type { TtsProviderId } from '@/lib/providers/tts-registry';
import { invalidatePodcastCache, publishPodcastStatus } from '@/lib/redis';
import { getAutoModelConfig } from '@/lib/auto-model-config';
import { assignVoicesForPodcast } from '@/lib/voice-assigner';
import type { ScriptTurn } from '@/lib/script-generator';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = authResult.userId;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true, status: true, ttsProvider: true, ttsModel: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }
  if (podcast.userId !== userId) {
    return errorResponse('Forbidden', 403);
  }
  if (podcast.status !== 'SCRIPT_READY') {
    return errorResponse('Script can only be approved when status is SCRIPT_READY', 400);
  }

  // Parse optional audio config from request body
  let bodyTtsProvider: string | undefined;
  let bodyTtsModel: string | undefined;
  let bodyVoices: Array<{ speaker: string; voiceId: string | null }> | undefined;
  try {
    const body = await request.json();
    bodyTtsProvider = body?.ttsProvider;
    bodyTtsModel = body?.ttsModel;
    bodyVoices = body?.voices;
  } catch {
    // No JSON body — use defaults
  }

  const autoConfig = await getAutoModelConfig();
  const nextTtsProvider = bodyTtsProvider ?? podcast.ttsProvider ?? autoConfig.model.ttsProvider;
  const nextTtsModel = bodyTtsProvider
    ? (bodyTtsModel ?? null)
    : (podcast.ttsModel ?? autoConfig.model.ttsModel);

  await prisma.podcast.update({
    where: { id: podcastId },
    data: { ttsProvider: nextTtsProvider, ttsModel: nextTtsModel },
  });

  // Fetch resolved ttsProvider for voice assignment and tag conversion
  // (must happen after TTS provider is written to DB above)
  const resolvedPodcast = await prisma.podcast.findUniqueOrThrow({
    where: { id: podcastId },
    select: { ttsProvider: true },
  });
  if (!resolvedPodcast.ttsProvider) {
    return errorResponse('Choose a TTS provider before approving the script.', 400, {
      code: 'tts_provider_required',
    });
  }
  const resolvedProvider = resolvedPodcast.ttsProvider as TtsProviderId;

  // Write explicit custom voice selections if provided; auto-assigned speakers are filled below.
  if (bodyVoices && bodyVoices.length > 0) {
    await prisma.podcastVoice.deleteMany({ where: { podcastId } });
    const explicitVoices = bodyVoices
      .filter((v) => typeof v.voiceId === 'string' && v.voiceId.trim().length > 0)
      .map((v) => ({ podcastId, speaker: v.speaker, voiceId: v.voiceId!.trim(), provider: resolvedProvider }));

    if (explicitVoices.length > 0) {
      await prisma.podcastVoice.createMany({
        data: explicitVoices,
      });
    }
  }

  const [script, discovery] = await Promise.all([
    prisma.script.findUnique({ where: { podcastId } }),
    prisma.discovery.findFirst({ where: { podcastId }, select: { speakers: true } }),
  ]);
  if (!script) {
    return errorResponse('Script not found', 404);
  }

  const turns = script.turns as ScriptTurn[];

  // Derive speakers from discovery or script turns
  const discoverySpeakers = discovery?.speakers as Array<{ name: string; description?: string }> | null;
  const speakers = discoverySpeakers && discoverySpeakers.length > 0
    ? discoverySpeakers
    : [...new Set(turns.map((t) => t.speaker))].map((name) => ({ name }));

  await assignVoicesForPodcast(podcastId, speakers, resolvedProvider);

  // Convert TTS tags before creating segments
  const turnData = turns.map((t) => ({ speaker: t.speaker, text: t.text, direction: t.direction }));
  const convertedTurns = await convertTurnsForProvider(turnData, resolvedProvider, { mode: 'disabled' });

  await createSegmentsAndQueueAudio(podcastId, convertedTurns);

  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'GENERATING_AUDIO' },
  });
  await invalidatePodcastCache(podcastId);
  await publishPodcastStatus(podcastId, { status: 'GENERATING_AUDIO' });

  return NextResponse.json({ success: true });
}
