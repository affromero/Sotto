import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
});

import {
  createWorker,
  keyValidationQueue,
  pricingFetchQueue,
  ttsProviderMonitorQueue,
  JobType,
} from '@/lib/queue';
import { logger } from '@/lib/logger';
import { closeRedis } from '@/lib/redis';
import { processContentExtraction } from './content-extraction.worker';
import { processDeepResearch } from './deep-research.worker';
import { processCreativePlanning } from './creative-planning.worker';
import { processScriptWriting } from './script-writing.worker';
import { processCompileScript } from './compile-script.worker';
import { processScriptGeneration } from './script-generation.worker';
import { processAudioGeneration } from './audio-generation.worker';
import { processAudioStitching } from './audio-stitching.worker';
import { processInteraction } from './interaction.worker';
import { processSegmentRegeneration } from './segment-regeneration.worker';
import { processNotification } from './notification.worker';
import { processPdfGeneration } from './pdf-generation.worker';
import { processKeyValidation } from './key-validation.worker';
import { processPricingFetch } from './pricing-fetch.worker';
import { processTtsProviderMonitor } from './tts-provider-monitor.worker';
import { processVisualClassification } from './visual-classification.worker';
import { processVisualGeneration } from './visual-generation.worker';
import { processVideoComposition } from './video-composition.worker';
import { processAvatarGeneration } from './avatar-generation.worker';
import { processPlaceEnrichment } from './place-enrichment.worker';
import { processTransitionGeneration } from './transition-generation.worker';
import { processSegmentPreview } from './segment-preview.worker';
import { processDemoScriptGeneration } from './demo-script-generation.worker';
import { processDemoRecording } from './demo-recording.worker';
import { processDemoVoiceover } from './demo-voiceover.worker';
import { processDemoVisual } from './demo-visual.worker';
import { processDemoTransition } from './demo-transition.worker';
import { processDemoComposition } from './demo-composition.worker';
import { processDemoSceneComposition } from './demo-scene-composition.worker';
import { processLipSyncTest } from './lip-sync-test.worker';
import { processWaveformGeneration } from './waveform-generation.worker';
import { processPipelineClassification } from './pipeline-classification.worker';
import { processSpeakingGrading } from './speaking-grading.worker';
import { processWorksheetPdf } from './worksheet-pdf.worker';
import { processVerifyClassReferences } from './verify-class-references.worker';
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

import {
  shouldRun as shouldRunRouting,
  EXPERIMENTAL_WORKERS,
} from './worker-routing';

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
  excludeQueues: WORKER_QUEUE_EXCLUDE_FILTER.size > 0 ? Array.from(WORKER_QUEUE_EXCLUDE_FILTER) : [],
  ...(WORKER_PRESET === 'core' && { experimentalExcluded: Array.from(EXPERIMENTAL_WORKERS) }),
});

// Create workers filtered by WORKER_PROFILE
const workers = [
  shouldRun('content-extraction') && createWorker('content-extraction', processContentExtraction, { concurrency: 2 }),
  shouldRun('deep-research') && createWorker('deep-research', processDeepResearch, { concurrency: 2, lockDuration: 300000 }),
  shouldRun('creative-planning') && createWorker('creative-planning', processCreativePlanning, { concurrency: 2, lockDuration: 300000 }),
  shouldRun('script-writing') && createWorker('script-writing', processScriptWriting, { concurrency: 2, lockDuration: 300000 }),
  shouldRun('compile-script') && createWorker('compile-script', processCompileScript, { concurrency: 2 }),
  shouldRun('script-generation') && createWorker('script-generation', processScriptGeneration, { concurrency: 2, lockDuration: 300000 }),
  shouldRun('audio-generation') && createWorker('audio-generation', processAudioGeneration, { concurrency: 15 }),
  shouldRun('audio-stitching') && createWorker('audio-stitching', processAudioStitching, { concurrency: 1, lockDuration: 120000 }),
  shouldRun('interactions') && createWorker('interactions', processInteraction, { concurrency: 3 }),
  shouldRun('segment-regeneration') && createWorker('segment-regeneration', processSegmentRegeneration, { concurrency: 2 }),
  shouldRun('notifications') && createWorker('notifications', processNotification, { concurrency: 5 }),
  shouldRun('pdf-generation') && createWorker('pdf-generation', processPdfGeneration, { concurrency: 2 }),
  shouldRun('key-validation') && createWorker('key-validation', processKeyValidation, { concurrency: 1 }),
  shouldRun('pricing-fetch') && createWorker('pricing-fetch', processPricingFetch, { concurrency: 1 }),
  shouldRun('tts-provider-monitor') && createWorker('tts-provider-monitor', processTtsProviderMonitor, { concurrency: 1 }),
  shouldRun('visual-classification') && createWorker('visual-classification', processVisualClassification, { concurrency: 2 }),
  shouldRun('visual-generation') && createWorker('visual-generation', processVisualGeneration, { concurrency: 5 }),
  shouldRun('video-composition') && createWorker('video-composition', processVideoComposition, { concurrency: 1, lockDuration: 600000 }),
  shouldRun('avatar-generation') && createWorker('avatar-generation', processAvatarGeneration, { concurrency: 2, lockDuration: 1200000 }),
  shouldRun('place-enrichment') && createWorker('place-enrichment', processPlaceEnrichment, { concurrency: 3 }),
  shouldRun('transition-generation') && createWorker('transition-generation', processTransitionGeneration, { concurrency: 3, lockDuration: 600000 }),
  shouldRun('segment-preview') && createWorker('segment-preview', processSegmentPreview, { concurrency: 3, lockDuration: 300000 }),
  shouldRun('demo-script') && createWorker('demo-script', processDemoScriptGeneration, { concurrency: 2 }),
  shouldRun('demo-recording') && createWorker('demo-recording', processDemoRecording, { concurrency: 1, lockDuration: 600000 }),
  shouldRun('demo-voiceover') && createWorker('demo-voiceover', processDemoVoiceover, { concurrency: 5 }),
  shouldRun('demo-visual') && createWorker('demo-visual', processDemoVisual, { concurrency: 3 }),
  shouldRun('demo-transition') && createWorker('demo-transition', processDemoTransition, { concurrency: 2 }),
  shouldRun('demo-composition') && createWorker('demo-composition', processDemoComposition, { concurrency: 1, lockDuration: 900000 }),
  shouldRun('demo-scene-composition') && createWorker('demo-scene-composition', processDemoSceneComposition, { concurrency: 2, lockDuration: 600000 }),
  shouldRun('lip-sync-test') && createWorker('lip-sync-test', processLipSyncTest, { concurrency: 2, lockDuration: 300000 }),
  shouldRun('waveform-generation') && createWorker('waveform-generation', processWaveformGeneration, { concurrency: 2 }),
  shouldRun('pipeline-classification') && createWorker('pipeline-classification', processPipelineClassification, { concurrency: 2, lockDuration: 300000 }),
  shouldRun('speaking-grading') && createWorker('speaking-grading', processSpeakingGrading, { concurrency: 5 }),
  shouldRun('worksheet-pdf') && createWorker('worksheet-pdf', processWorksheetPdf, { concurrency: 2 }),
  shouldRun('verify-class-references') && createWorker('verify-class-references', processVerifyClassReferences, { concurrency: 2 }),
].filter(Boolean) as ReturnType<typeof createWorker>[];

// Cron jobs and webhooks run only on light (or all) profile to prevent duplicate repeat registrations
if (WORKER_PROFILE === 'all' || WORKER_PROFILE === 'light') {
// Schedule cleanup every 2 hours (stale drafts + stuck video generations)
// Schedule BYOK key re-validation every 24 hours
if (shouldRun('key-validation')) {
  keyValidationQueue
    .add(JobType.VALIDATE_KEYS, {}, { repeat: { every: 24 * 60 * 60 * 1000 } })
    .then(() => logger.info('BYOK key validation scheduled', { intervalMs: '86400000' }))
    .catch((err) => logger.error('Failed to schedule key validation', { error: err.message }));
}

// Schedule daily TTS provider monitor (6am UTC)
if (shouldRun('tts-provider-monitor')) {
  ttsProviderMonitorQueue
    .add(JobType.MONITOR_TTS_PROVIDERS, {}, { repeat: { pattern: '0 6 * * *' } })
    .then(() => logger.info('TTS provider monitor scheduled', { schedule: '6:00 UTC daily' }))
    .catch((err) => logger.error('Failed to schedule TTS provider monitor', { error: err.message }));
}

// Schedule daily pricing fetch (every 24 hours)
if (shouldRun('pricing-fetch')) {
  pricingFetchQueue
    .add(JobType.FETCH_PRICING, {}, { repeat: { every: 86400000 } })
    .then(() => logger.info('Pricing fetch scheduled', { intervalMs: '86400000' }))
    .catch((err) => logger.error('Failed to schedule pricing fetch', { error: err.message }));
}

// Start in-memory pricing refresh interval (picks up DB changes every 5 min)
startPricingRefreshInterval();
} // end WORKER_PROFILE === 'all' || 'light'

logger.info(`${workers.length} workers started`, { profile: WORKER_PROFILE });

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down workers...');
  await Promise.all(workers.map((w) => w.close()));
  await closeRedis();
  logger.info('All workers stopped');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
