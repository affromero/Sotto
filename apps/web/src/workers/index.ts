import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
});

import {
  createWorker,
  twitterMentionsQueue,
  telegramBotQueue,
  keyValidationQueue,
  twitterTrendPollQueue,
  emailDigestQueue,
  draftCleanupQueue,
  r2UsageQueue,
  pricingFetchQueue,
  ttsProviderMonitorQueue,
  featureComputationQueue,
  newsIngestQueue,
  briefingSchedulerQueue,
  JobType,
} from '@/lib/queue';
import { processAnnouncement } from './announcement.worker';
import { isTwitterConfigured } from '@/lib/twitter';
import { getTwitterConfig } from '@/lib/twitter-config';
import { isTelegramBotConfigured, setWebhook, deleteWebhook } from '@/lib/telegram';
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
import { processTwitterMentions } from './twitter-mentions.worker';
import { processTwitterReply } from './twitter-reply.worker';
import { processEventIngestion } from './event-ingestion.worker';
import { processFeatureComputation } from './feature-computation.worker';
import { processDataExport } from './data-export.worker';
import { processAudioImport } from './audio-import.worker';
import { processKeyValidation } from './key-validation.worker';
import { processTelegramUpdates } from './telegram-bot.worker';
import { processTelegramReply } from './telegram-reply.worker';
import { processAutoTweet } from './twitter-auto-tweet.worker';
import { processTrendPoll } from './twitter-trend-poll.worker';
import { processAdminThreadToPodcast } from './admin-thread-to-podcast.worker';
import { processContentModeration } from './content-moderation.worker';
import { processEmailDigest } from './email-digest.worker';
import { processVoiceVerification } from './voice-verification.worker';
import { processVoiceTrackAudio } from './voice-track-audio.worker';
import { processVoiceTrackStitching } from './voice-track-stitching.worker';
import { processDraftCleanup } from './draft-cleanup.worker';
import { processR2Usage } from './r2-usage.worker';
import { processPricingFetch } from './pricing-fetch.worker';
import { processTtsProviderMonitor } from './tts-provider-monitor.worker';
import { processVisualClassification } from './visual-classification.worker';
import { processVisualGeneration } from './visual-generation.worker';
import { processVideoComposition } from './video-composition.worker';
import { processAvatarGeneration } from './avatar-generation.worker';
import { processPlaceEnrichment } from './place-enrichment.worker';
import { processTransitionGeneration } from './transition-generation.worker';
import { processSegmentPreview } from './segment-preview.worker';
import { processNewsIngest } from './news-ingest.worker';
import { processDemoScriptGeneration } from './demo-script-generation.worker';
import { processDemoRecording } from './demo-recording.worker';
import { processDemoVoiceover } from './demo-voiceover.worker';
import { processDemoVisual } from './demo-visual.worker';
import { processDemoTransition } from './demo-transition.worker';
import { processDemoComposition } from './demo-composition.worker';
import { processDemoSceneComposition } from './demo-scene-composition.worker';
import { processMusicGeneration } from './music-generation.worker';
import { processLipSyncTest } from './lip-sync-test.worker';
import { processWaveformGeneration } from './waveform-generation.worker';
import { processQuizGeneration } from './quiz-generation.worker';
import { processBriefingScheduler } from './briefing-scheduler.worker';
import { processPipelineClassification } from './pipeline-classification.worker';
import { isR2MonitoringConfigured } from '@/lib/cloudflare-r2-usage';
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
  shouldRun('audio-stitching') && createWorker('audio-stitching', processAudioStitching, { concurrency: 1 }),
  shouldRun('interactions') && createWorker('interactions', processInteraction, { concurrency: 3 }),
  shouldRun('segment-regeneration') && createWorker('segment-regeneration', processSegmentRegeneration, { concurrency: 2 }),
  shouldRun('notifications') && createWorker('notifications', processNotification, { concurrency: 5 }),
  shouldRun('pdf-generation') && createWorker('pdf-generation', processPdfGeneration, { concurrency: 2 }),
  shouldRun('twitter-mentions') && createWorker('twitter-mentions', processTwitterMentions, { concurrency: 1 }),
  shouldRun('twitter-reply') && createWorker('twitter-reply', processTwitterReply, { concurrency: 2 }),
  shouldRun('event-ingestion') && createWorker('event-ingestion', processEventIngestion, { concurrency: 5 }),
  shouldRun('feature-computation') && createWorker('feature-computation', processFeatureComputation, { concurrency: 2 }),
  shouldRun('data-export') && createWorker('data-export', processDataExport, { concurrency: 1 }),
  shouldRun('audio-import') && createWorker('audio-import', processAudioImport, { concurrency: 2 }),
  shouldRun('key-validation') && createWorker('key-validation', processKeyValidation, { concurrency: 1 }),
  shouldRun('telegram-bot') && createWorker('telegram-bot', processTelegramUpdates, { concurrency: 1, lockDuration: 10000 }),
  shouldRun('telegram-reply') && createWorker('telegram-reply', processTelegramReply, { concurrency: 2 }),
  shouldRun('twitter-auto-tweet') && createWorker('twitter-auto-tweet', processAutoTweet, { concurrency: 1 }),
  shouldRun('twitter-trend-poll') && createWorker('twitter-trend-poll', processTrendPoll, { concurrency: 1 }),
  shouldRun('admin-thread-to-podcast') && createWorker('admin-thread-to-podcast', processAdminThreadToPodcast, { concurrency: 1 }),
  shouldRun('content-moderation') && createWorker('content-moderation', processContentModeration, { concurrency: 3 }),
  shouldRun('email-digest') && createWorker('email-digest', processEmailDigest, { concurrency: 1 }),
  shouldRun('announcements') && createWorker('announcements', processAnnouncement, { concurrency: 1 }),
  shouldRun('voice-verification') && createWorker('voice-verification', processVoiceVerification, { concurrency: 2 }),
  shouldRun('voice-track-audio') && createWorker('voice-track-audio', processVoiceTrackAudio, { concurrency: 10 }),
  shouldRun('voice-track-stitching') && createWorker('voice-track-stitching', processVoiceTrackStitching, { concurrency: 1 }),
  shouldRun('draft-cleanup') && createWorker('draft-cleanup', processDraftCleanup, { concurrency: 1 }),
  shouldRun('r2-usage') && createWorker('r2-usage', processR2Usage, { concurrency: 1 }),
  shouldRun('pricing-fetch') && createWorker('pricing-fetch', processPricingFetch, { concurrency: 1 }),
  shouldRun('tts-provider-monitor') && createWorker('tts-provider-monitor', processTtsProviderMonitor, { concurrency: 1 }),
  shouldRun('visual-classification') && createWorker('visual-classification', processVisualClassification, { concurrency: 2 }),
  shouldRun('visual-generation') && createWorker('visual-generation', processVisualGeneration, { concurrency: 5 }),
  shouldRun('video-composition') && createWorker('video-composition', processVideoComposition, { concurrency: 1, lockDuration: 600000 }),
  shouldRun('avatar-generation') && createWorker('avatar-generation', processAvatarGeneration, { concurrency: 2, lockDuration: 1200000 }),
  shouldRun('place-enrichment') && createWorker('place-enrichment', processPlaceEnrichment, { concurrency: 3 }),
  shouldRun('transition-generation') && createWorker('transition-generation', processTransitionGeneration, { concurrency: 3, lockDuration: 600000 }),
  shouldRun('segment-preview') && createWorker('segment-preview', processSegmentPreview, { concurrency: 3, lockDuration: 300000 }),
  shouldRun('news-ingest') && createWorker('news-ingest', processNewsIngest, { concurrency: 1 }),
  shouldRun('demo-script') && createWorker('demo-script', processDemoScriptGeneration, { concurrency: 2 }),
  shouldRun('demo-recording') && createWorker('demo-recording', processDemoRecording, { concurrency: 1, lockDuration: 600000 }),
  shouldRun('demo-voiceover') && createWorker('demo-voiceover', processDemoVoiceover, { concurrency: 5 }),
  shouldRun('demo-visual') && createWorker('demo-visual', processDemoVisual, { concurrency: 3 }),
  shouldRun('demo-transition') && createWorker('demo-transition', processDemoTransition, { concurrency: 2 }),
  shouldRun('demo-composition') && createWorker('demo-composition', processDemoComposition, { concurrency: 1, lockDuration: 900000 }),
  shouldRun('demo-scene-composition') && createWorker('demo-scene-composition', processDemoSceneComposition, { concurrency: 2, lockDuration: 600000 }),
  shouldRun('music-generation') && createWorker('music-generation', processMusicGeneration, { concurrency: 2, lockDuration: 600000 }),
  shouldRun('lip-sync-test') && createWorker('lip-sync-test', processLipSyncTest, { concurrency: 2, lockDuration: 300000 }),
  shouldRun('waveform-generation') && createWorker('waveform-generation', processWaveformGeneration, { concurrency: 2 }),
  shouldRun('quiz-generation') && createWorker('quiz-generation', processQuizGeneration, { concurrency: 2 }),
  shouldRun('briefing-scheduler') && createWorker('briefing-scheduler', processBriefingScheduler, { concurrency: 1 }),
  shouldRun('pipeline-classification') && createWorker('pipeline-classification', processPipelineClassification, { concurrency: 2, lockDuration: 300000 }),
].filter(Boolean) as ReturnType<typeof createWorker>[];

// Cron jobs and webhooks run only on light (or all) profile to prevent duplicate repeat registrations
if (WORKER_PROFILE === 'all' || WORKER_PROFILE === 'light') {
// Set up Twitter mentions polling if credentials are configured
if (shouldRun('twitter-mentions') && isTwitterConfigured()) {
  getTwitterConfig()
    .catch((err) => {
      logger.warn('Failed to read Twitter config at startup, using env/defaults', { error: err.message });
      return null;
    })
    .then((config) => {
      const pollInterval = config?.mentionPollIntervalMs
        || parseInt(process.env.TWITTER_POLL_INTERVAL_MS || '60000', 10);
      return twitterMentionsQueue
        .add(JobType.POLL_TWITTER_MENTIONS, {}, { repeat: { every: pollInterval } })
        .then(() =>
          logger.info('Twitter mentions polling scheduled', { intervalMs: String(pollInterval) })
        );
    })
    .catch((err) => logger.error('Failed to schedule Twitter polling', { error: err.message }));
} else if (shouldRun('twitter-mentions')) {
  logger.info('Twitter integration not configured — polling disabled');
}

// Set up Telegram bot: webhook (production) or polling (dev)
if (shouldRun('telegram-bot') && isTelegramBotConfigured()) {
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (webhookUrl && webhookSecret) {
    // Webhook mode: clear any stale polling jobs first, then register the webhook
    telegramBotQueue
      .obliterate({ force: true })
      .then(() => setWebhook(webhookUrl, webhookSecret))
      .then(() => logger.info('Telegram webhook registered', { url: webhookUrl }))
      .catch((err) => logger.error('Failed to register Telegram webhook', { error: err.message }));
  } else {
    // Dev: clear any stale webhook, then start fast polling
    deleteWebhook()
      .then(() => telegramBotQueue.obliterate({ force: true }))
      .then(() => {
        const pollInterval = parseInt(process.env.TELEGRAM_POLL_INTERVAL_MS || '5000', 10);
        return telegramBotQueue.add(JobType.POLL_TELEGRAM_UPDATES, {}, { repeat: { every: pollInterval } });
      })
      .then(() => logger.info('Telegram bot polling scheduled (dev mode)'))
      .catch((err) => logger.error('Failed to set up Telegram polling', { error: err.message }));
  }
} else if (shouldRun('telegram-bot')) {
  logger.info('Telegram bot not configured — disabled');
}

// Set up Twitter trend polling if credentials are configured
if (shouldRun('twitter-trend-poll') && isTwitterConfigured()) {
  const trendInterval = parseInt(process.env.TWITTER_TREND_POLL_INTERVAL_MS || '7200000', 10);
  twitterTrendPollQueue
    .add(JobType.POLL_TWITTER_TRENDS, {}, { repeat: { every: trendInterval } })
    .then(() =>
      logger.info('Twitter trend polling scheduled', { intervalMs: String(trendInterval) })
    )
    .catch((err) => logger.error('Failed to schedule trend polling', { error: err.message }));
} else if (shouldRun('twitter-trend-poll')) {
  logger.info('Twitter integration not configured — trend polling disabled');
}

// Schedule weekly email digest (Sunday 10:00 UTC)
if (shouldRun('email-digest')) {
  emailDigestQueue
    .add(JobType.SEND_EMAIL_DIGEST, {}, { repeat: { pattern: '0 10 * * 0' } })
    .then(() => logger.info('Weekly email digest scheduled', { schedule: 'Sunday 10:00 UTC' }))
    .catch((err) => logger.error('Failed to schedule email digest', { error: err.message }));
}

// Schedule cleanup every 2 hours (stale drafts + stuck video generations)
if (shouldRun('draft-cleanup')) {
  draftCleanupQueue
    .add(JobType.CLEANUP_DRAFTS, {}, { repeat: { every: 2 * 60 * 60 * 1000 } })
    .then(() => logger.info('Cleanup scheduled', { intervalMs: '7200000' }))
    .catch((err) => logger.error('Failed to schedule cleanup', { error: err.message }));
}

// Schedule BYOK key re-validation every 24 hours
if (shouldRun('key-validation')) {
  keyValidationQueue
    .add(JobType.VALIDATE_KEYS, {}, { repeat: { every: 24 * 60 * 60 * 1000 } })
    .then(() => logger.info('BYOK key validation scheduled', { intervalMs: '86400000' }))
    .catch((err) => logger.error('Failed to schedule key validation', { error: err.message }));
}

// Schedule daily R2 usage collection if Cloudflare API token is configured
if (shouldRun('r2-usage') && isR2MonitoringConfigured()) {
  r2UsageQueue
    .add(JobType.COLLECT_R2_USAGE, {}, { repeat: { every: 86400000 } })
    .then(() => logger.info('R2 usage monitoring scheduled', { intervalMs: '86400000' }))
    .catch((err) => logger.error('Failed to schedule R2 usage monitoring', { error: err.message }));
} else if (shouldRun('r2-usage')) {
  logger.info('R2 monitoring not configured — usage collection disabled');
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

// Schedule daily ML feature computation catch-up (every 24 hours)
if (shouldRun('feature-computation')) {
  featureComputationQueue
    .add(JobType.COMPUTE_FEATURES, { scope: 'all' }, { repeat: { every: 86400000 } })
    .then(() => logger.info('Feature computation catch-up scheduled', { intervalMs: '86400000' }))
    .catch((err) => logger.error('Failed to schedule feature computation', { error: err.message }));
}

// Schedule news ingestion every 4 hours
if (shouldRun('news-ingest')) {
  newsIngestQueue
    .add(JobType.INGEST_NEWS, {}, { repeat: { every: 4 * 60 * 60 * 1000 } })
    .then(() => logger.info('News ingestion scheduled', { intervalMs: '14400000' }))
    .catch((err) => logger.error('Failed to schedule news ingestion', { error: err.message }));

  // Briefing scheduler (every 1 hour)
  briefingSchedulerQueue
    .add(JobType.SCHEDULE_BRIEFINGS, {}, { repeat: { every: 60 * 60 * 1000 } })
    .then(() => logger.info('Briefing scheduler started', { intervalMs: '3600000' }))
    .catch((err) => logger.error('Failed to schedule briefings', { error: err.message }));
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
