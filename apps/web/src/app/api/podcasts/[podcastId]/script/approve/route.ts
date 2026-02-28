import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { createSegmentsAndQueueAudio } from '@/lib/segment-creator';
import { checkRateLimit } from '@/lib/redis';
import { checkGenerationGate } from '@/lib/generation-gate';
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
    const msg =
      gate.reason === 'free_tier_exhausted'
        ? 'Free generations used. Add your own API keys to continue.'
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

  const script = await prisma.script.findUnique({
    where: { podcastId },
  });
  if (!script) {
    return errorResponse('Script not found', 404);
  }

  const turns = script.turns as ScriptTurn[];
  await createSegmentsAndQueueAudio(
    podcastId,
    turns.map((t) => ({ speaker: t.speaker, text: t.text, direction: t.direction }))
  );

  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'GENERATING_AUDIO' },
  });

  return NextResponse.json({ success: true });
}
