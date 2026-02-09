import { createWorker, twitterMentionsQueue, JobType } from '@/lib/queue';
import { isTwitterConfigured } from '@/lib/twitter';
import { logger } from '@/lib/logger';
import { processContentExtraction } from './content-extraction.worker';
import { processScriptGeneration } from './script-generation.worker';
import { processReferenceValidation } from './reference-validation.worker';
import { processAudioGeneration } from './audio-generation.worker';
import { processAudioStitching } from './audio-stitching.worker';
import { processInteraction } from './interaction.worker';
import { processSegmentRegeneration } from './segment-regeneration.worker';
import { processNotification } from './notification.worker';
import { processPdfGeneration } from './pdf-generation.worker';
import { processTwitterMentions } from './twitter-mentions.worker';
import { processTwitterReply } from './twitter-reply.worker';

logger.info('Starting Sotto workers...');

// Create all workers with appropriate concurrency
const workers = [
  createWorker('content-extraction', processContentExtraction, { concurrency: 2 }),
  createWorker('script-generation', processScriptGeneration, { concurrency: 2 }),
  createWorker('reference-validation', processReferenceValidation, { concurrency: 2 }),
  createWorker('audio-generation', processAudioGeneration, { concurrency: 5 }),
  createWorker('audio-stitching', processAudioStitching, { concurrency: 1 }),
  createWorker('interactions', processInteraction, { concurrency: 3 }),
  createWorker('segment-regeneration', processSegmentRegeneration, { concurrency: 2 }),
  createWorker('notifications', processNotification, { concurrency: 5 }),
  createWorker('pdf-generation', processPdfGeneration, { concurrency: 2 }),
  createWorker('twitter-mentions', processTwitterMentions, { concurrency: 1 }),
  createWorker('twitter-reply', processTwitterReply, { concurrency: 2 }),
];

// Set up Twitter mentions polling if credentials are configured
if (isTwitterConfigured()) {
  const pollInterval = parseInt(process.env.TWITTER_POLL_INTERVAL_MS || '60000', 10);
  twitterMentionsQueue
    .add(JobType.POLL_TWITTER_MENTIONS, {}, { repeat: { every: pollInterval } })
    .then(() => logger.info('Twitter mentions polling scheduled', { intervalMs: String(pollInterval) }))
    .catch((err) => logger.error('Failed to schedule Twitter polling', { error: err.message }));
} else {
  logger.info('Twitter integration not configured — polling disabled');
}

logger.info(`${workers.length} workers started`);

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down workers...');
  await Promise.all(workers.map((w) => w.close()));
  logger.info('All workers stopped');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
