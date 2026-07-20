import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { segmentRegenerationQueue, addJob, JobType } from '@/lib/queue';
import { createAIProvider } from '@/lib/providers/ai';
import { logUsage } from '@/lib/usage-logger';
import { CONTENT_SAFETY_INSTRUCTIONS } from '@/lib/safety-prompts';
import { VOICE_REALISM_SHORT } from '@/lib/voice-realism-prompts';
import { loadAndRender } from '@/lib/prompt-loader';
import { getAiKey } from '@/lib/byok';
import {
  providerRequiresAiKey,
  resolveAiModelAndProvider,
  type AiProviderId,
} from '@/lib/providers/ai-registry';
import { getLanguageLabel } from '@sotto/shared';

import type { RegenerateSegmentPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ episodeId: string; interactionId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { episodeId, interactionId } = await params;
  const authed = await authenticateRequest(request);

  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = authed.userId;

  // Fetch the interaction with episode ownership check
  const interaction = await prisma.interaction.findUnique({
    where: { id: interactionId },
    include: {
      episode: {
        select: {
          id: true,
          userId: true,
          status: true,
          source: true,
          language: true,
          aiModel: true,
        },
      },
    },
  });

  if (!interaction || interaction.episodeId !== episodeId) {
    return errorResponse('Interaction not found', 404);
  }

  // Only the episode owner can incorporate
  if (interaction.episode.userId !== userId) {
    return errorResponse('Forbidden', 403);
  }

  if (interaction.episode.source === 'IMPORT') {
    return errorResponse('Incorporation not yet supported for imported episodes', 400);
  }

  // Interaction must be answered or resolved
  if (!['ANSWERED', 'RESOLVED'].includes(interaction.status)) {
    return errorResponse(`Cannot incorporate interaction with status "${interaction.status}"`, 409);
  }

  // Episode must be in READY state
  if (interaction.episode.status !== 'READY') {
    return errorResponse(
      `Episode is currently "${interaction.episode.status}", must be READY`,
      409
    );
  }

  const aiKey = interaction.episode.aiModel ? null : await getAiKey(userId);
  if (!interaction.episode.aiModel && !aiKey) {
    return errorResponse(
      'AI model is required for incorporation when no AI key is configured.',
      403,
      {
        code: 'ai_key_required',
      }
    );
  }

  // Resolve model + provider from episode's creation-time selection
  const { model: resolvedModel, provider } = await resolveAiModelAndProvider({
    episodeAiModel: interaction.episode.aiModel,
    aiKey,
  });

  const providerAiKey =
    interaction.episode.aiModel && providerRequiresAiKey(provider)
      ? await getAiKey(userId, provider as AiProviderId)
      : aiKey;
  if (interaction.episode.aiModel && providerRequiresAiKey(provider) && !providerAiKey) {
    return errorResponse(`AI key for provider "${provider}" is required for incorporation.`, 403, {
      code: 'ai_key_required',
    });
  }

  // Set interaction to INCORPORATING
  await prisma.interaction.update({
    where: { id: interactionId },
    data: { status: 'INCORPORATING' },
  });

  // Set episode to UPDATING
  await prisma.episode.update({
    where: { id: episodeId },
    data: { status: 'UPDATING' },
  });

  // Find the segment closest to the interaction timestamp
  const segments = await prisma.segment.findMany({
    where: { episodeId },
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

  // Generate the explanation segment text via Claude
  // Always use episode language for incorporation (segment becomes part of the audio)
  const episodeLanguage = interaction.episode.language || 'en';
  const languageLabel = getLanguageLabel(episodeLanguage) || 'English';

  const systemPrompt =
    loadAndRender('interaction/incorporate-segment.md', {
      ACTIVE_SPEAKER: activeSpeaker,
      LANGUAGE_LABEL: languageLabel,
    }) +
    VOICE_REALISM_SHORT +
    CONTENT_SAFETY_INSTRUCTIONS;

  const ai = createAIProvider(provider);
  const response = await ai.generateResponse(
    systemPrompt,
    [
      {
        role: 'user',
        content: `Episode context around timestamp ${interaction.timestamp}s:\n${contextSegments}\n\nListener's question: ${interaction.question}\n\nAI's answer: ${interaction.answer}\n\nWrite a natural episode segment that addresses this question and answer.`,
      },
    ],
    { apiKeyOverride: providerAiKey?.apiKey, model: resolvedModel }
  );

  await logUsage({
    service: provider,
    model: response.model,
    category: 'incorporation',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    episodeId,
    userId,
  });

  // Queue segment regeneration
  const payload: RegenerateSegmentPayload = {
    episodeId,
    interactionId,
    insertAfterOrder,
    newText: response.content,
    speaker: activeSpeaker,
  };

  await addJob(segmentRegenerationQueue, JobType.REGENERATE_SEGMENT, payload, {
    jobId: `segment-regeneration-${interactionId}`,
  });

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
