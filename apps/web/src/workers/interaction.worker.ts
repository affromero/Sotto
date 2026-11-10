import { Job } from 'bullmq';
import { ProcessInteractionPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { createAIProvider } from '@/lib/providers/ai';
import { logUsage } from '@/lib/usage-logger';
import { CONTENT_SAFETY_INSTRUCTIONS, INPUT_SANITIZATION_INSTRUCTIONS } from '@/lib/safety-prompts';
import { VOICE_REALISM_SHORT } from '@/lib/voice-realism-prompts';
import { loadAndRender } from '@/lib/prompt-loader';
import { ContentModerationError } from '@/lib/moderation';
import { capturedLearningAiOptions, resolveCapturedEpisodeAi } from '@/lib/learning-ai';
import {
  completeDurableQueueJob,
  durableJobProviderExecution,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import { completePublishedInteraction } from '@/lib/sidedoor/jobs/interaction-recovery';
import { getLanguageLabel } from '@sotto/shared';
import { CHARS_PER_SECOND } from '@/lib/duration';
import { logger } from '@/lib/logger';
import type { Prisma } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoStateWriteTransaction } from '@/lib/sidedoor/access/state/write-transaction';
import {
  InteractionEpisodeNotFoundError,
  readInteractionEpisode,
} from '@/lib/sidedoor/jobs/interaction-access';
import { processClassLessonHelp } from './interactions/class-lesson-help.worker';
import { processVocabularyExamples } from './interactions/vocabulary-examples.worker';
import { processVocabularyRefill } from './interactions/vocabulary-refill.worker';
import { processClassPrerequisite } from './interactions/class-prerequisite.worker';
import { processClassAssessment } from './interactions/class-assessment.worker';

export async function processInteraction(
  job: Job<ProcessInteractionPayload>,
  signal?: AbortSignal,
  token?: string
): Promise<void> {
  if (job.name === 'interactions.v2') return processClassLessonHelp(job, signal);
  if (job.name === 'interactions.v3') return processVocabularyExamples(job, signal);
  if (job.name === 'interactions.v4') return processVocabularyRefill(job, signal);
  if (job.name === 'interactions.v5') return processClassPrerequisite(job, signal);
  if (job.name === 'interactions.v6') return processClassAssessment(job, signal, token);
  const { episodeId, interactionId, userId, question, timestamp } = job.data;

  logger.info('Processing interaction', { episodeId, interactionId });
  await job.updateProgress(10);

  const admitted = durableJobProviderExecution(job, userId, signal);
  const execution = {
    ...admitted,
    authorize: async (database: Prisma.TransactionClient) => {
      const actor = await admitted.authorize(database);
      if (actor.userId !== userId) throw new InteractionEpisodeNotFoundError();
      const current = await readInteractionEpisode(database, episodeId);
      if (current.userId !== userId && current.visibility !== 'UNLISTED')
        throw new InteractionEpisodeNotFoundError();
      return actor;
    },
  };
  const capture = await sottoTransaction(
    prisma,
    async (database) => {
      await execution.authorize(database);
      const interaction = await database.interaction.findUnique({
        where: { id: interactionId, episodeId },
        select: { userId: true, question: true, timestamp: true, status: true, answer: true },
      });
      if (
        !interaction ||
        interaction.userId !== userId ||
        interaction.question !== question ||
        interaction.timestamp !== timestamp
      )
        throw new Error('Interaction inputs changed');
      if (
        interaction.answer !== null &&
        ['ANSWERED', 'RESOLVED', 'INCORPORATING', 'INCORPORATED'].includes(interaction.status)
      )
        return { published: true as const };
      if (interaction.status !== 'PENDING') throw new Error('Interaction inputs changed');
      const [episode, user, script, segments] = await Promise.all([
        database.episode.findUnique({
          where: { id: episodeId },
          select: { language: true, aiModel: true, aiProvider: true },
        }),
        database.user.findUnique({ where: { id: userId }, select: { preferredLanguage: true } }),
        database.script.findUnique({ where: { episodeId } }),
        database.segment.findMany({
          where: { episodeId },
          orderBy: { order: 'asc' },
          select: { order: true, startTime: true, duration: true },
        }),
      ]);
      return { published: false as const, episode, user, script, segments };
    },
    { signal }
  );
  if (capture.published) {
    await sottoStateWriteTransaction(
      prisma,
      async (database) => {
        if (!(await completePublishedInteraction(database, job, signal)))
          throw new Error('Interaction operation changed');
      },
      signal ?? new AbortController().signal
    );
    return;
  }
  const { episode, user, script, segments } = capture;

  if (!episode) throw new Error(`Episode not found: ${episodeId}`);
  const ai = await resolveCapturedEpisodeAi({
    userId,
    aiModel: episode.aiModel,
    aiProvider: episode.aiProvider,
    allowSharing: false,
    execution,
  });
  const {
    model,
    apiKeyOverride,
    fetch: providerFetch,
    signal: providerSignal,
  } = await capturedLearningAiOptions(ai);
  const provider = ai.provider;

  // Get episode script context
  if (!script) throw new Error(`Script not found for episode ${episodeId}`);

  const turns = script.turns as Array<{ speaker: string; text: string }>;

  // Find position in script using segment startTime + duration
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
      {
        apiKeyOverride,
        model,
        fetch: providerFetch,
        signal: providerSignal,
      }
    );
  } catch (err) {
    if (err instanceof ContentModerationError) {
      // Content policy violation — mark interaction failed, don't retry
      await publishInteraction('Unable to answer — content policy violation.');
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
  await publishInteraction(response.content, segmentOrder);

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

  async function publishInteraction(answer: string, order?: number | null) {
    await sottoStateWriteTransaction(
      prisma,
      async (database) => {
        await execution.authorize(database);
        await database.$queryRaw`SELECT id FROM "Interaction" WHERE id = ${interactionId} FOR UPDATE`;
        const current = await database.interaction.findUnique({
          where: { id: interactionId, episodeId },
          select: { userId: true, question: true, timestamp: true, status: true },
        });
        if (
          !current ||
          current.userId !== userId ||
          current.question !== question ||
          current.timestamp !== timestamp ||
          current.status !== 'PENDING'
        )
          throw new Error('Interaction inputs changed');
        await completeDurableQueueJob(database, job);
        await database.interaction.update({
          where: { id: interactionId },
          data: {
            answer,
            status: 'ANSWERED',
            ...(order === undefined ? {} : { segmentOrder: order }),
          },
        });
      },
      signal ?? new AbortController().signal
    );
  }
}
