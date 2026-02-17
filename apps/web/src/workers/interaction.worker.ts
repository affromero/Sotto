import { Job } from 'bullmq';
import { ProcessInteractionPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { generateResponse, logApiUsage } from '@/lib/claude';
import { getAiKey } from '@/lib/byok';
import { logger } from '@/lib/logger';

export async function processInteraction(job: Job<ProcessInteractionPayload>): Promise<void> {
  const { podcastId, interactionId, userId, question, timestamp } = job.data;

  logger.info('Processing interaction', { podcastId, interactionId });
  await job.updateProgress(10);

  const aiKey = await getAiKey(userId);

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
      elapsed += turns[i].text.length / 12.5;
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

  const systemPrompt = `You are Sotto's Q&A assistant. The user is listening to a podcast and paused to ask a question.
Answer concisely and helpfully, using the podcast context. Keep answers under 200 words.`;

  const response = await generateResponse(systemPrompt, [
    {
      role: 'user',
      content: `Recent podcast context:\n${recentContext}\n\nUser's question: ${question}`,
    },
  ], { apiKeyOverride: aiKey?.apiKey });

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

  await logApiUsage({
    podcastId,
    userId,
    category: 'interaction',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  });

  await job.updateProgress(100);
  logger.info('Interaction processed', { podcastId, interactionId });
}
