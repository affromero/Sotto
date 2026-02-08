import { Job } from 'bullmq';
import { ProcessInteractionPayload } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { generateResponse, logApiUsage } from '@/lib/claude';
import { logger } from '@/lib/logger';

export async function processInteraction(job: Job<ProcessInteractionPayload>): Promise<void> {
  const { podcastId, interactionId, userId, question, timestamp } = job.data;

  logger.info('Processing interaction', { podcastId, interactionId });
  await job.updateProgress(10);

  // Get podcast script context
  const script = await prisma.script.findUnique({ where: { podcastId } });
  if (!script) throw new Error(`Script not found for podcast ${podcastId}`);

  const turns = script.turns as Array<{ speaker: string; text: string }>;

  // Find approximate position in script based on timestamp
  const contextTurns = turns.slice(0, Math.min(turns.length, Math.ceil(timestamp / 10)));
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
  ]);

  await job.updateProgress(80);

  // Update interaction with answer
  await prisma.interaction.update({
    where: { id: interactionId },
    data: {
      answer: response.content,
      status: 'ANSWERED',
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
