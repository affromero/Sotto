import { createWorker } from '@/lib/queue';
import { logger } from '@/lib/logger';
import { processContentExtraction } from './content-extraction.worker';
import { processScriptGeneration } from './script-generation.worker';
import { processAudioGeneration } from './audio-generation.worker';
import { processAudioStitching } from './audio-stitching.worker';
import { processInteraction } from './interaction.worker';
import { processSegmentRegeneration } from './segment-regeneration.worker';
import { processNotification } from './notification.worker';
import { processPdfGeneration } from './pdf-generation.worker';

logger.info('Starting Sotto workers...');

// Create all workers with appropriate concurrency
const workers = [
  createWorker('content-extraction', processContentExtraction, { concurrency: 2 }),
  createWorker('script-generation', processScriptGeneration, { concurrency: 2 }),
  createWorker('audio-generation', processAudioGeneration, { concurrency: 5 }),
  createWorker('audio-stitching', processAudioStitching, { concurrency: 1 }),
  createWorker('interactions', processInteraction, { concurrency: 3 }),
  createWorker('segment-regeneration', processSegmentRegeneration, { concurrency: 2 }),
  createWorker('notifications', processNotification, { concurrency: 5 }),
  createWorker('pdf-generation', processPdfGeneration, { concurrency: 2 }),
];

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
