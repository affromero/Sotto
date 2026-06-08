import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { createSegmentsAndQueueAudio } from '@/lib/segment-creator';
import { convertTurnsForProvider } from '@/lib/tts-tag-converter';
import type { TtsProviderId } from '@/lib/providers/tts-registry';
import { checkRateLimit, invalidatePodcastCache, publishPodcastStatus } from '@/lib/redis';
import { checkGenerationGate } from '@/lib/generation-gate';
import { selectFreeTierProviders } from '@/lib/free-tier-provider-selector';
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

  // Rate limit: 20/hour, 100/day
  const hourly = await checkRateLimit(`generate:hour:${userId}`, 20, 3600);
  if (!hourly.allowed) {
    return errorResponse('Rate limit exceeded: max 20 generations per hour.', 429);
  }
  const daily = await checkRateLimit(`generate:day:${userId}`, 100, 86400);
  if (!daily.allowed) {
    return errorResponse('Rate limit exceeded: max 100 generations per day.', 429);
  }

  // Generation gate: BYOK or free tier (re-check — user may have lost keys since script creation)
  const gate = await checkGenerationGate(userId);
  if (!gate.allowed) {
    const msg = gate.reason === 'generation_in_progress'
      ? 'A podcast is already generating. Wait for it to finish before starting another.'
      : 'No voice provider available. Add a TTS key in Settings for unlimited generation.';
    return errorResponse(msg, 403, { code: gate.reason });
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true, status: true },
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

  // Write TTS provider at approve time (deferred from pipeline start)
  if (gate.isByokUser) {
    if (bodyTtsProvider) {
      // BYOK user explicitly picked a provider
      await prisma.podcast.update({
        where: { id: podcastId },
        data: { ttsProvider: bodyTtsProvider, ttsModel: bodyTtsModel ?? null },
      });
    }
    // Otherwise keep the existing provider. A missing provider is rejected below.
  } else {
    // Free-tier: auto-select provider (moved from generate route)
    const selected = await selectFreeTierProviders(userId);
    await prisma.podcast.update({
      where: { id: podcastId },
      data: { ttsProvider: selected.ttsProvider, ttsModel: selected.ttsModel },
    });
  }

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
