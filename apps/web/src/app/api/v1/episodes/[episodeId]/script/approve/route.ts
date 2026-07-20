import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { createSegmentsAndQueueAudio } from '@/lib/segment-creator';
import { convertTurnsForProvider } from '@/lib/tts-tag-converter';
import type { TtsProviderId } from '@/lib/providers/tts-registry';
import { invalidateEpisodeCache, publishEpisodeStatus } from '@/lib/redis';
import { getAutoModelConfig } from '@/lib/auto-model-config';
import { assignVoicesForEpisode } from '@/lib/voice-assigner';
import type { ScriptTurn } from '@/lib/script-generator';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ episodeId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = authResult.userId;

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { userId: true, status: true, ttsProvider: true, ttsModel: true },
  });

  if (!episode) {
    return errorResponse('Episode not found', 404);
  }
  if (episode.userId !== userId) {
    return errorResponse('Forbidden', 403);
  }
  if (episode.status !== 'SCRIPT_READY') {
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
  const nextTtsProvider = bodyTtsProvider ?? episode.ttsProvider ?? autoConfig.model.ttsProvider;
  const nextTtsModel = bodyTtsProvider
    ? (bodyTtsModel ?? null)
    : (episode.ttsModel ?? autoConfig.model.ttsModel);
  if (!nextTtsProvider) {
    return errorResponse('Choose a TTS provider before approving the script.', 400, {
      code: 'tts_provider_required',
    });
  }

  const [script, discovery] = await Promise.all([
    prisma.script.findUnique({ where: { episodeId } }),
    prisma.discovery.findFirst({ where: { episodeId }, select: { speakers: true } }),
  ]);
  if (!script) {
    return errorResponse('Script not found', 404);
  }

  // Claim the episode before making any configuration, voice, segment, or
  // queue mutations. Concurrent approvals therefore have one clear winner.
  const claimed = await prisma.episode.updateMany({
    where: { id: episodeId, status: 'SCRIPT_READY' },
    data: { status: 'GENERATING_AUDIO' },
  });
  if (claimed.count === 0) {
    return errorResponse('Script approval is already in progress', 409);
  }

  try {
    await prisma.episode.update({
      where: { id: episodeId },
      data: { ttsProvider: nextTtsProvider, ttsModel: nextTtsModel },
    });

    // Fetch resolved ttsProvider for voice assignment and tag conversion
    // (must happen after TTS provider is written to DB above)
    const resolvedEpisode = await prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      select: { ttsProvider: true },
    });
    if (!resolvedEpisode.ttsProvider) {
      return errorResponse('Choose a TTS provider before approving the script.', 400, {
        code: 'tts_provider_required',
      });
    }
    const resolvedProvider = resolvedEpisode.ttsProvider as TtsProviderId;

    // Write explicit custom voice selections if provided; auto-assigned speakers are filled below.
    if (bodyVoices && bodyVoices.length > 0) {
      await prisma.episodeVoice.deleteMany({ where: { episodeId } });
      const explicitVoices = bodyVoices
        .filter((v) => typeof v.voiceId === 'string' && v.voiceId.trim().length > 0)
        .map((v) => ({
          episodeId,
          speaker: v.speaker,
          voiceId: v.voiceId!.trim(),
          provider: resolvedProvider,
        }));

      if (explicitVoices.length > 0) {
        await prisma.episodeVoice.createMany({
          data: explicitVoices,
        });
      }
    }

    const turns = script.turns as ScriptTurn[];

    // Derive speakers from discovery or script turns
    const discoverySpeakers = discovery?.speakers as Array<{
      name: string;
      description?: string;
    }> | null;
    const speakers =
      discoverySpeakers && discoverySpeakers.length > 0
        ? discoverySpeakers
        : [...new Set(turns.map((t) => t.speaker))].map((name) => ({ name }));

    await assignVoicesForEpisode(episodeId, speakers, resolvedProvider);

    // Convert TTS tags before creating segments
    const turnData = turns.map((t) => ({
      speaker: t.speaker,
      text: t.text,
      direction: t.direction,
    }));
    const convertedTurns = await convertTurnsForProvider(turnData, resolvedProvider, {
      mode: 'disabled',
    });

    await createSegmentsAndQueueAudio(episodeId, convertedTurns);

    await invalidateEpisodeCache(episodeId);
    await publishEpisodeStatus(episodeId, { status: 'GENERATING_AUDIO' });

    return NextResponse.json({ success: true });
  } catch (error) {
    await prisma.episode.updateMany({
      where: { id: episodeId, status: 'GENERATING_AUDIO' },
      data: {
        status: 'SCRIPT_READY',
        audioGenerationKey: null,
        failureReason: error instanceof Error ? error.message : 'Audio setup failed',
      },
    });
    await invalidateEpisodeCache(episodeId);
    await publishEpisodeStatus(episodeId, { status: 'SCRIPT_READY' });
    return errorResponse(
      'Could not start audio generation. The script remains ready to retry.',
      500
    );
  }
}
