import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
});

import {
  createWorker,
  pricingFetchQueue,
  JobType,
  withDispatchQueue,
  ALL_QUEUE_NAMES,
  createQueue,
  admitDurableJob,
} from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { startSottoJobReconciliation } from '@/lib/sidedoor/jobs/core/job-reconciliation';
import { sottoJobFailureCode } from '@/lib/sidedoor/jobs/core/job-contracts';
import { logger } from '@/lib/logger';
import { closeRedis } from '@/lib/redis';
import { processContentExtraction } from '@/workers/content-extraction.worker';
import { processDeepResearch } from '@/workers/deep-research.worker';
import { processCreativePlanning } from '@/workers/creative-planning.worker';
import { processScriptWriting } from '@/workers/script-writing.worker';
import { processCompileScript } from '@/workers/compile-script.worker';
import { processAudioGeneration } from '@/workers/audio-generation.worker';
import { processAudioStitching } from '@/workers/audio-stitching.worker';
import { processInteraction } from '@/workers/interaction.worker';
import { processSegmentRegeneration } from '@/workers/segment-regeneration.worker';
import { processNotification } from '@/workers/notification.worker';
import { processPdfGeneration } from '@/workers/pdf-generation.worker';
import { processKeyValidation } from '@/workers/key-validation.worker';
import { scheduleAllCredentialValidations } from '@/workers/key-validation.worker';
import { processPricingFetch } from '@/workers/pricing-fetch.worker';
import { processWaveformGeneration } from '@/workers/waveform-generation.worker';
import { processEpisodeStatus } from '@/workers/durable/status/episode-status.worker';
import { processSpeakingGrading } from '@/workers/speaking-grading.worker';
import { processWorksheetPdf } from '@/workers/worksheet-pdf.worker';
import { startPricingRefreshInterval } from '@/lib/pricing';

const WORKER_PROFILE = process.env.WORKER_PROFILE || 'all';
const WORKER_PRESET = process.env.WORKER_PRESET || 'full';
const WORKER_QUEUE_FILTER = new Set(
  (process.env.WORKER_QUEUES || '')
    .split(',')
    .map((queue) => queue.trim())
    .filter(Boolean)
);
const WORKER_QUEUE_EXCLUDE_FILTER = new Set(
  (process.env.WORKER_EXCLUDE_QUEUES || '')
    .split(',')
    .map((queue) => queue.trim())
    .filter(Boolean)
);

import { shouldRun as shouldRunRouting, EXPERIMENTAL_WORKERS } from './worker-routing';

let hasWarnedOnUnknownPreset = false;

function shouldRun(name: string): boolean {
  // Warn once on unknown preset (side effect kept out of pure module)
  if (WORKER_PRESET !== 'full' && WORKER_PRESET !== 'core' && !hasWarnedOnUnknownPreset) {
    logger.warn('Unknown worker preset, defaulting to full queue set', { preset: WORKER_PRESET });
    hasWarnedOnUnknownPreset = true;
  }
  return shouldRunRouting(name, {
    profile: WORKER_PROFILE,
    preset: WORKER_PRESET,
    includeFilter: WORKER_QUEUE_FILTER,
    excludeFilter: WORKER_QUEUE_EXCLUDE_FILTER,
  });
}

logger.info('Starting Sotto workers...', {
  profile: WORKER_PROFILE,
  preset: WORKER_PRESET,
  includeQueues: WORKER_QUEUE_FILTER.size > 0 ? Array.from(WORKER_QUEUE_FILTER) : 'all',
  excludeQueues:
    WORKER_QUEUE_EXCLUDE_FILTER.size > 0 ? Array.from(WORKER_QUEUE_EXCLUDE_FILTER) : [],
  ...(WORKER_PRESET === 'core' && { experimentalExcluded: Array.from(EXPERIMENTAL_WORKERS) }),
});

// Create workers filtered by WORKER_PROFILE
const workers = [
  shouldRun('content-extraction') &&
    createWorker('content-extraction', processContentExtraction, { concurrency: 2 }),
  shouldRun('deep-research') &&
    createWorker('deep-research', processDeepResearch, { concurrency: 2, lockDuration: 300000 }),
  shouldRun('creative-planning') &&
    createWorker('creative-planning', processCreativePlanning, {
      concurrency: 2,
      lockDuration: 300000,
    }),
  shouldRun('script-writing') &&
    createWorker('script-writing', processScriptWriting, { concurrency: 2, lockDuration: 300000 }),
  shouldRun('compile-script') &&
    createWorker('compile-script', processCompileScript, { concurrency: 2 }),
  shouldRun('audio-generation') &&
    createWorker('audio-generation', processAudioGeneration, { concurrency: 15 }),
  shouldRun('audio-stitching') &&
    createWorker('audio-stitching', processAudioStitching, {
      concurrency: 1,
      lockDuration: 120000,
    }),
  shouldRun('interactions') && createWorker('interactions', processInteraction, { concurrency: 3 }),
  shouldRun('segment-regeneration') &&
    createWorker('segment-regeneration', processSegmentRegeneration, { concurrency: 2 }),
  shouldRun('notifications') &&
    createWorker('notifications', processNotification, { concurrency: 5 }),
  shouldRun('pdf-generation') &&
    createWorker('pdf-generation', processPdfGeneration, { concurrency: 2 }),
  shouldRun('key-validation') &&
    createWorker('key-validation', processKeyValidation, { concurrency: 1 }),
  shouldRun('pricing-fetch') &&
    createWorker('pricing-fetch', processPricingFetch, { concurrency: 1 }),
  shouldRun('waveform-generation') &&
    createWorker('waveform-generation', processWaveformGeneration, { concurrency: 2 }),
  shouldRun('episode-status') &&
    createWorker('episode-status', processEpisodeStatus, { concurrency: 5 }),
  shouldRun('speaking-grading') &&
    createWorker('speaking-grading', processSpeakingGrading, { concurrency: 5 }),
  shouldRun('worksheet-pdf') &&
    createWorker('worksheet-pdf', processWorksheetPdf, { concurrency: 2 }),
].filter(Boolean) as ReturnType<typeof createWorker>[];

// The outbox job identity is the UTC day. Every restart immediately reconciles
// today's work, so an in-memory timer cannot create a missed day.
const recurringTimers = new Set<ReturnType<typeof setTimeout>>();

function scheduleRecurring(label: string, delay: () => number, operation: () => Promise<void>) {
  const run = async () => {
    await operation().catch((error) =>
      logger.error(`${label} failed`, {
        error: error instanceof Error ? error.message : String(error),
      })
    );
    const timer = setTimeout(() => {
      recurringTimers.delete(timer);
      void run();
    }, delay());
    recurringTimers.add(timer);
  };
  void run();
}

async function admitScheduled(queue: typeof pricingFetchQueue, type: JobType, jobId: string) {
  await admitDurableJob(
    queue,
    type,
    {},
    {
      jobId,
      authorize: async (database) => {
        await sottoStorageInstance(database).read();
      },
      mutate: async () => {},
    }
  );
}

if (WORKER_PROFILE === 'all' || WORKER_PROFILE === 'light') {
  const day = 24 * 60 * 60 * 1000;
  if (shouldRun('key-validation'))
    scheduleRecurring(
      'Credential validation scheduling',
      () => day,
      async () => {
        await scheduleAllCredentialValidations();
      }
    );

  if (shouldRun('pricing-fetch'))
    scheduleRecurring(
      'Pricing fetch scheduling',
      () => day,
      async () => {
        const bucket = new Date().toISOString().slice(0, 10);
        await admitScheduled(pricingFetchQueue, JobType.FETCH_PRICING, `pricing-fetch:${bucket}`);
      }
    );

  // Start in-memory pricing refresh interval (picks up DB changes every 5 min)
  startPricingRefreshInterval();
} // end WORKER_PROFILE === 'all' || 'light'

logger.info(`${workers.length} workers started`, { profile: WORKER_PROFILE });

// Every eligible host can restore queue delivery. Execution still follows its worker profile.
const durableQueues = new Map(ALL_QUEUE_NAMES.map((name) => [name, createQueue(name)]));
const reconciliation = [...durableQueues.keys()].some(shouldRun)
  ? startSottoJobReconciliation({
      database: prisma,
      queues: durableQueues,
      withQueue: withDispatchQueue,
      onResults: (results) => {
        for (const result of results) {
          if (result.status === 'failed')
            logger.error('Durable job delivery failed; work remains pending', {
              operationId: result.id,
              reason: sottoJobFailureCode(result.error),
            });
        }
      },
      onError: (error) => {
        logger.error(
          'Durable job reconciliation failed. Check migration, database and Redis availability.',
          {
            reason: sottoJobFailureCode(error),
          }
        );
      },
    })
  : null;
reconciliation?.done.catch(() => {
  logger.error('Durable job reconciliation stopped unexpectedly');
  process.exitCode = 1;
  void shutdown();
});

// Graceful shutdown
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const timer of recurringTimers) clearTimeout(timer);
  logger.info('Shutting down workers...');
  await Promise.all(workers.map((worker) => worker.pause(true)));
  for (const worker of workers) worker.cancelAllJobs();
  await reconciliation?.stop().catch(() => {
    logger.error('Durable job reconciliation stopped with an error');
  });
  await Promise.all(workers.map((w) => w.close()));
  await closeRedis();
  logger.info('All workers stopped');
  process.exit(process.exitCode ?? 0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
