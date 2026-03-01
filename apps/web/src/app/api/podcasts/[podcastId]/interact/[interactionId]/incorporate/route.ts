import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { segmentRegenerationQueue, addJob, JobType } from '@/lib/queue';
import { createAIProvider } from '@/lib/providers/ai';
import { logUsage } from '@/lib/usage-logger';
import { CONTENT_SAFETY_INSTRUCTIONS } from '@/lib/safety-prompts';
import { VOICE_REALISM_SHORT } from '@/lib/voice-realism-prompts';
import { loadAndRender } from '@/lib/prompt-loader';
import { getAiKey } from '@/lib/byok';
import { resolveAiModelAndProvider } from '@/lib/providers/ai-registry';
import { getLanguageLabel } from '@sotto/shared';
import { checkGenerationGate } from '@/lib/generation-gate';

import { checkRateLimit } from '@/lib/redis';
import type { RegenerateSegmentPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string; interactionId: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { podcastId, interactionId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = session.user.id;

  // Rate limit: 20/hour, 100/day
  const hourly = await checkRateLimit(`generate:hour:${userId}`, 20, 3600);
  if (!hourly.allowed) {
    return errorResponse('Rate limit exceeded: max 20 generations per hour.', 429);
  }
  const daily = await checkRateLimit(`generate:day:${userId}`, 100, 86400);
  if (!daily.allowed) {
    return errorResponse('Rate limit exceeded: max 100 generations per day.', 429);
  }

  // Fetch the interaction with podcast ownership check
  const interaction = await prisma.interaction.findUnique({
    where: { id: interactionId },
    include: {
      podcast: { select: { id: true, userId: true, status: true, source: true, language: true, aiModel: true } },
    },
  });

  if (!interaction || interaction.podcastId !== podcastId) {
    return errorResponse('Interaction not found', 404);
  }

  // Only the podcast owner can incorporate
  if (interaction.podcast.userId !== userId) {
    return errorResponse('Forbidden', 403);
  }

  // Generation gate
  const gate = await checkGenerationGate(userId);
  if (!gate.allowed) {
    const msg = gate.reason === 'generation_in_progress'
      ? 'A podcast is already generating. Wait for it to finish before starting another.'
      : 'No voice provider available. Add a TTS key in Settings for unlimited generation.';
    return errorResponse(msg, 403, { code: gate.reason });
  }

  // Quota consumed on success by workers — no increment here

  if (interaction.podcast.source === 'IMPORT') {
    return errorResponse('Incorporation not yet supported for imported podcasts', 400);
  }

  // Interaction must be answered or resolved
  if (!['ANSWERED', 'RESOLVED'].includes(interaction.status)) {
    return errorResponse(`Cannot incorporate interaction with status "${interaction.status}"`, 409);
  }

  // Podcast must be in READY state
  if (interaction.podcast.status !== 'READY') {
    return errorResponse(`Podcast is currently "${interaction.podcast.status}", must be READY`, 409);
  }

  // Set interaction to INCORPORATING
  await prisma.interaction.update({
    where: { id: interactionId },
    data: { status: 'INCORPORATING' },
  });

  // Set podcast to UPDATING
  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'UPDATING' },
  });

  // Find the segment closest to the interaction timestamp
  const segments = await prisma.segment.findMany({
    where: { podcastId },
    orderBy: { order: 'asc' },
    select: { order: true, startTime: true, duration: true, speaker: true, text: true },
  });

  let insertAfterOrder = 0;
  let activeSpeaker = segments[0]?.speaker ?? 'HOST';
  for (const seg of segments) {
    const segEnd = (seg.startTime ?? 0) + (seg.duration ?? 0);
    if (interaction.timestamp <= segEnd) {
      insertAfterOrder = seg.order;
      activeSpeaker = seg.speaker;
      break;
    }
    insertAfterOrder = seg.order;
    activeSpeaker = seg.speaker;
  }

  // Get surrounding context for generating the incorporation text
  const contextSegments = segments
    .filter((s) => Math.abs(s.order - insertAfterOrder) <= 2)
    .map((s) => `${s.speaker}: ${s.text}`)
    .join('\n');

  // Resolve user's AI key for BYOK passthrough
  const aiKey = await getAiKey(userId);

  // Resolve model + provider from podcast's creation-time selection
  const { model: resolvedModel, provider } = await resolveAiModelAndProvider({
    podcastAiModel: interaction.podcast.aiModel,
    aiKey,
  });

  // Generate the explanation segment text via Claude
  // Always use podcast language for incorporation (segment becomes part of the audio)
  const podcastLanguage = interaction.podcast.language || 'en';
  const languageLabel = getLanguageLabel(podcastLanguage) || 'English';

  const systemPrompt = loadAndRender('interaction/incorporate-segment.md', { ACTIVE_SPEAKER: activeSpeaker, LANGUAGE_LABEL: languageLabel }) + VOICE_REALISM_SHORT + CONTENT_SAFETY_INSTRUCTIONS;

  const ai = createAIProvider(provider);
  const response = await ai.generateResponse(systemPrompt, [
    {
      role: 'user',
      content: `Podcast context around timestamp ${interaction.timestamp}s:\n${contextSegments}\n\nListener's question: ${interaction.question}\n\nAI's answer: ${interaction.answer}\n\nWrite a natural podcast segment that addresses this question and answer.`,
    },
  ], { apiKeyOverride: aiKey?.apiKey, model: resolvedModel });

  await logUsage({
    service: provider,
    model: response.model,
    category: 'incorporation',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    podcastId,
    userId,
  });

  // Queue segment regeneration
  const payload: RegenerateSegmentPayload = {
    podcastId,
    interactionId,
    insertAfterOrder,
    newText: response.content,
    speaker: activeSpeaker,
  };

  await addJob(segmentRegenerationQueue, JobType.REGENERATE_SEGMENT, payload);

  return NextResponse.json(
    {
      status: 'incorporating',
      interactionId,
      insertAfterOrder,
      generatedText: response.content,
    },
    { status: 202 }
  );
}
