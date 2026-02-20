import { Job } from 'bullmq';
import { ProcessInteractionPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { generateResponse } from '@/lib/claude';
import { logUsage } from '@/lib/usage-logger';
import { CONTENT_SAFETY_INSTRUCTIONS, INPUT_SANITIZATION_INSTRUCTIONS } from '@/lib/safety-prompts';
import { ContentModerationError } from '@/lib/moderation';
import { getAiKey, hasByokKey } from '@/lib/byok';
import { getFreeTierConfig } from '@/lib/free-tier-config';
import { getTierFeatures } from '@/lib/tier-features';
import { getAiProviderMeta, type AiProviderId } from '@/lib/providers/ai-registry';
import { getLanguageLabel } from '@sotto/shared';
import { CHARS_PER_SECOND } from '@/lib/duration';
import { logger } from '@/lib/logger';

export async function processInteraction(job: Job<ProcessInteractionPayload>): Promise<void> {
  const { podcastId, interactionId, userId, question, timestamp } = job.data;

  logger.info('Processing interaction', { podcastId, interactionId });
  await job.updateProgress(10);

  const [aiKey, hasTts, podcast, user, userPlan] = await Promise.all([
    getAiKey(userId),
    hasByokKey(userId),
    prisma.podcast.findUnique({ where: { id: podcastId }, select: { language: true, aiModel: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { preferredLanguage: true } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } }),
  ]);

  const tierFeatures = getTierFeatures(userPlan.plan as 'FREE' | 'PRO', hasTts);

  // Enforce Q&A interaction limit for free users
  if (isFinite(tierFeatures.maxQaInteractions)) {
    const existingCount = await prisma.interaction.count({
      where: { podcastId, userId, answer: { not: null } },
    });
    if (existingCount >= tierFeatures.maxQaInteractions) {
      await prisma.interaction.update({
        where: { id: interactionId },
        data: {
          answer: `You've reached the Q&A limit for free podcasts (${tierFeatures.maxQaInteractions} questions). Upgrade to Pro for unlimited Q&A.`,
          status: 'ANSWERED',
        },
      });
      logger.info('Q&A limit reached', { userId, podcastId, limit: tierFeatures.maxQaInteractions });
      await job.updateProgress(100);
      return;
    }
  }

  // Model priority: user's choice > provider default > free tier admin config
  let model = podcast?.aiModel ?? undefined;
  if (!model && aiKey) {
    model = getAiProviderMeta(aiKey.provider as AiProviderId).defaultModel;
  }
  if (!model) {
    const config = await getFreeTierConfig();
    model = config.aiAllocations.length > 0
      ? config.aiAllocations[0].model
      : config.aiModel;
  }

  // Get podcast script context
  const script = await prisma.script.findUnique({ where: { podcastId } });
  if (!script) throw new Error(`Script not found for podcast ${podcastId}`);

  const turns = script.turns as Array<{ speaker: string; text: string }>;

  // Find position in script using segment startTime + duration
  const segments = await prisma.segment.findMany({
    where: { podcastId },
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

  // Language priority: user preference > podcast language > English
  const responseLanguage = user?.preferredLanguage || podcast?.language || 'en';
  const languageLabel = getLanguageLabel(responseLanguage) || 'English';

  const systemPrompt = `You are Sotto's Q&A assistant. The user is listening to a podcast and paused to ask a question.
Answer concisely and helpfully, using the podcast context. Keep answers under 200 words. Respond in ${languageLabel}.${CONTENT_SAFETY_INSTRUCTIONS}${INPUT_SANITIZATION_INSTRUCTIONS}`;

  let response;
  try {
    response = await generateResponse(systemPrompt, [
      {
        role: 'user',
        content: `Recent podcast context:\n${recentContext}\n\nUser's question: ${question}`,
      },
    ], { apiKeyOverride: aiKey?.apiKey, model });
  } catch (err) {
    if (err instanceof ContentModerationError) {
      // Content policy violation — mark interaction failed, don't retry
      await prisma.interaction.update({
        where: { id: interactionId },
        data: { answer: 'Unable to answer — content policy violation.', status: 'ANSWERED' },
      });
      logger.warn('Interaction blocked by content moderation', { interactionId, categories: err.categories });
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
    service: 'anthropic',
    model: response.model,
    category: 'interaction',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    podcastId,
    userId,
  });

  await job.updateProgress(100);
  logger.info('Interaction processed', { podcastId, interactionId });
}
