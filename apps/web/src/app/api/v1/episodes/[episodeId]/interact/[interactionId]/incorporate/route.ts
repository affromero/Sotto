import { NextRequest, NextResponse } from 'next/server';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  captureIncorporation,
  commitIncorporation,
  prepareIncorporation,
  IncorporationAdmissionError,
  incorporationPosition,
} from '@/lib/sidedoor/jobs/stitch/incorporation';
import { EpisodeStorageChangedError } from '@/lib/sidedoor/storage/core/episode-storage';
import { createAIProvider, type AIResponse } from '@/lib/providers/ai';
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

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ episodeId: string; interactionId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    try {
      return await incorporate(request, await params);
    } catch (error) {
      if (error instanceof IncorporationAdmissionError)
        return errorResponse(error.message, error.status);
      if (error instanceof EpisodeStorageChangedError)
        return errorResponse('Episode ownership changed during generation', 409);
      throw error;
    }
  });
}

async function incorporate(
  request: NextRequest,
  { episodeId, interactionId }: { episodeId: string; interactionId: string }
) {
  const admission = await sottoTransaction(prisma, (tx) =>
    captureIncorporation(tx, request, episodeId, interactionId)
  );
  const interaction = admission.inputs;
  const userId = admission.identity.userId;

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

  const segments = interaction.episode.segments;

  const { insertAfterOrder, speaker: activeSpeaker } = incorporationPosition(interaction);

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
  let response: AIResponse;
  try {
    response = await ai.generateResponse(
      systemPrompt,
      [
        {
          role: 'user',
          content: `Episode context around timestamp ${interaction.timestamp}s:\n${contextSegments}\n\nListener's question: ${interaction.question}\n\nAI's answer: ${interaction.answer}\n\nWrite a natural episode segment that addresses this question and answer.`,
        },
      ],
      { apiKeyOverride: providerAiKey?.apiKey, model: resolvedModel }
    );
  } catch {
    return errorResponse('AI generation failed. Check the selected provider and retry.', 502);
  }

  await logUsage({
    service: provider,
    model: response.model,
    category: 'incorporation',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    episodeId,
    userId,
  });

  const job = prepareIncorporation(admission, response.content);
  await sottoTransaction(prisma, (tx) => commitIncorporation(tx, request, admission, job));

  return NextResponse.json(
    {
      status: 'incorporating',
      interactionId,
      insertAfterOrder,
      generatedText: response.content,
      operationId: job.id,
    },
    { status: 202 }
  );
}
