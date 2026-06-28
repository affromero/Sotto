import { Job } from 'bullmq';
import { ProcessInteractionPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { createAIProvider } from '@/lib/providers/ai';
import { logUsage } from '@/lib/usage-logger';
import { CONTENT_SAFETY_INSTRUCTIONS, INPUT_SANITIZATION_INSTRUCTIONS } from '@/lib/safety-prompts';
import { VOICE_REALISM_SHORT } from '@/lib/voice-realism-prompts';
import { loadAndRender } from '@/lib/prompt-loader';
import { ContentModerationError } from '@/lib/moderation';
import { getAiKey } from '@/lib/byok';
import {
  providerRequiresAiKey,
  resolveAiModelAndProvider,
  type AiProviderId,
} from '@/lib/providers/ai-registry';
import { getLanguageLabel } from '@sotto/shared';
import { CHARS_PER_SECOND } from '@/lib/duration';
import { logger } from '@/lib/logger';

export async function processInteraction(job: Job<ProcessInteractionPayload>): Promise<void> {
  const { episodeId, interactionId, userId, question, timestamp } = job.data;

  logger.info('Processing interaction', { episodeId, interactionId });
  await job.updateProgress(10);

  const [episode, user] = await Promise.all([
    prisma.episode.findUnique({
      where: { id: episodeId },
      select: { language: true, aiModel: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { preferredLanguage: true } }),
  ]);

  const aiKey = episode?.aiModel ? null : await getAiKey(userId);
  if (!episode?.aiModel && !aiKey) {
    throw new Error('AI model is required for interactions when no AI key is configured.');
  }

  // Model + provider resolved together — prevents sending e.g. gpt-5-mini to Anthropic
  const { model, provider } = await resolveAiModelAndProvider({
    episodeAiModel: episode?.aiModel,
    aiKey,
  });

  const providerAiKey =
    episode?.aiModel && providerRequiresAiKey(provider)
      ? await getAiKey(userId, provider as AiProviderId)
      : aiKey;
  if (episode?.aiModel && providerRequiresAiKey(provider) && !providerAiKey) {
    throw new Error(`AI key for provider "${provider}" is required for interactions.`);
  }

  // Get episode script context
  const script = await prisma.script.findUnique({ where: { episodeId } });
  if (!script) throw new Error(`Script not found for episode ${episodeId}`);

  const turns = script.turns as Array<{ speaker: string; text: string }>;

  // Find position in script using segment startTime + duration
  const segments = await prisma.segment.findMany({
    where: { episodeId },
    orderBy: { order: 'asc' },
    select: { order: true, startTime: true, duration: true },
  });

  let turnIndex = turns.length;
  if (segments.length > 0 && segments[0].startTime !== null) {
    // Use segment timing data to find the turn at the given timestamp
    for (let i = 0; i < segments.length; i++) {
      const segStart = segments[i].startTime ?? 0;
      const segDur = segments[i].duration ?? 0;
      if (timestamp < segStart + segDur) {
        turnIndex = i + 1; // include this turn in context
        break;
      }
    }
  } else {
    // Fallback: estimate from text length if no timing data yet
    // Average ~12.5 chars/sec speech rate
    let elapsed = 0;
    for (let i = 0; i < turns.length; i++) {
      elapsed += turns[i].text.length / CHARS_PER_SECOND;
      if (elapsed >= timestamp) {
        turnIndex = i + 1;
        break;
      }
    }
  }

  const contextTurns = turns.slice(0, Math.min(turns.length, turnIndex));
  const recentContext = contextTurns
    .slice(-5)
    .map((t) => `${t.speaker}: ${t.text}`)
    .join('\n');

  // Language priority: user preference > episode language > English
  const responseLanguage = user?.preferredLanguage || episode?.language || 'en';
  const languageLabel = getLanguageLabel(responseLanguage) || 'English';

  const systemPrompt =
    loadAndRender('interaction/qa-assistant.md', { LANGUAGE_LABEL: languageLabel }) +
    VOICE_REALISM_SHORT +
    CONTENT_SAFETY_INSTRUCTIONS +
    INPUT_SANITIZATION_INSTRUCTIONS;

  let response;
  try {
    const ai = createAIProvider(provider);
    response = await ai.generateResponse(
      systemPrompt,
      [
        {
          role: 'user',
          content: `Recent episode context:\n${recentContext}\n\nUser's question: ${question}`,
        },
      ],
      { apiKeyOverride: providerAiKey?.apiKey, model }
    );
  } catch (err) {
    if (err instanceof ContentModerationError) {
      // Content policy violation — mark interaction failed, don't retry
      await prisma.interaction.update({
        where: { id: interactionId },
        data: { answer: 'Unable to answer — content policy violation.', status: 'ANSWERED' },
      });
      logger.warn('Interaction blocked by content moderation', {
        interactionId,
        categories: err.categories,
      });
      return;
    }
    throw err;
  }

  await job.updateProgress(80);

  // Compute segmentOrder: which segment the question maps to
  let segmentOrder: number | null = null;
  if (segments.length > 0 && segments[0].startTime !== null) {
    for (let i = 0; i < segments.length; i++) {
      const segStart = segments[i].startTime ?? 0;
      const segDur = segments[i].duration ?? 0;
      if (timestamp < segStart + segDur) {
        segmentOrder = segments[i].order;
        break;
      }
    }
  } else if (turnIndex > 0 && turnIndex <= segments.length) {
    segmentOrder = segments[turnIndex - 1].order;
  }

  // Update interaction with answer and segmentOrder
  await prisma.interaction.update({
    where: { id: interactionId },
    data: {
      answer: response.content,
      status: 'ANSWERED',
      segmentOrder,
    },
  });

  await logUsage({
    service: provider,
    model: response.model,
    category: 'interaction',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    episodeId,
    userId,
  });

  await job.updateProgress(100);
  logger.info('Interaction processed', { episodeId, interactionId });
}
