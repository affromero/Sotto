import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
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
  featureComputationQueue,
  JobType,
} from '@/lib/queue';
import { processAnnouncement } from './announcement.worker';
import { isTwitterConfigured } from '@/lib/twitter';
import { isTelegramBotConfigured, setWebhook, deleteWebhook } from '@/lib/telegram';
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
import { processScriptVerification } from './script-verification.worker';
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
import { processVisualClassification } from './visual-classification.worker';
import { processVisualGeneration } from './visual-generation.worker';
import { processVideoComposition } from './video-composition.worker';
import { processAvatarGeneration } from './avatar-generation.worker';
import { processPlaceEnrichment } from './place-enrichment.worker';
import { isR2MonitoringConfigured } from '@/lib/cloudflare-r2-usage';
import { startPricingRefreshInterval } from '@/lib/pricing';

logger.info('Starting Sotto workers...');

// Create all workers with appropriate concurrency
const workers = [
  createWorker('content-extraction', processContentExtraction, { concurrency: 2 }),
  createWorker('script-generation', processScriptGeneration, { concurrency: 2 }),
  createWorker('script-verification', processScriptVerification, { concurrency: 2 }),
  createWorker('reference-validation', processReferenceValidation, { concurrency: 2 }),
  createWorker('audio-generation', processAudioGeneration, { concurrency: 15 }),
  createWorker('audio-stitching', processAudioStitching, { concurrency: 1 }),
  createWorker('interactions', processInteraction, { concurrency: 3 }),
  createWorker('segment-regeneration', processSegmentRegeneration, { concurrency: 2 }),
  createWorker('notifications', processNotification, { concurrency: 5 }),
  createWorker('pdf-generation', processPdfGeneration, { concurrency: 2 }),
  createWorker('twitter-mentions', processTwitterMentions, { concurrency: 1 }),
  createWorker('twitter-reply', processTwitterReply, { concurrency: 2 }),
  createWorker('event-ingestion', processEventIngestion, { concurrency: 5 }),
  createWorker('feature-computation', processFeatureComputation, { concurrency: 2 }),
  createWorker('data-export', processDataExport, { concurrency: 1 }),
  createWorker('audio-import', processAudioImport, { concurrency: 2 }),
  createWorker('key-validation', processKeyValidation, { concurrency: 1 }),
  createWorker('telegram-bot', processTelegramUpdates, { concurrency: 1, lockDuration: 10000 }),
  createWorker('telegram-reply', processTelegramReply, { concurrency: 2 }),
  createWorker('twitter-auto-tweet', processAutoTweet, { concurrency: 1 }),
  createWorker('twitter-trend-poll', processTrendPoll, { concurrency: 1 }),
  createWorker('admin-thread-to-podcast', processAdminThreadToPodcast, { concurrency: 1 }),
  createWorker('content-moderation', processContentModeration, { concurrency: 3 }),
  createWorker('email-digest', processEmailDigest, { concurrency: 1 }),
  createWorker('announcements', processAnnouncement, { concurrency: 1 }),
  createWorker('voice-verification', processVoiceVerification, { concurrency: 2 }),
  createWorker('voice-track-audio', processVoiceTrackAudio, { concurrency: 10 }),
  createWorker('voice-track-stitching', processVoiceTrackStitching, { concurrency: 1 }),
  createWorker('draft-cleanup', processDraftCleanup, { concurrency: 1 }),
  createWorker('r2-usage', processR2Usage, { concurrency: 1 }),
  createWorker('pricing-fetch', processPricingFetch, { concurrency: 1 }),
  createWorker('visual-classification', processVisualClassification, { concurrency: 2 }),
  createWorker('visual-generation', processVisualGeneration, { concurrency: 5 }),
  createWorker('video-composition', processVideoComposition, { concurrency: 1, lockDuration: 600000 }),
  createWorker('avatar-generation', processAvatarGeneration, { concurrency: 2, lockDuration: 600000 }),
  createWorker('place-enrichment', processPlaceEnrichment, { concurrency: 3 }),
];

// Set up Twitter mentions polling if credentials are configured
if (isTwitterConfigured()) {
  const pollInterval = parseInt(process.env.TWITTER_POLL_INTERVAL_MS || '60000', 10);
  twitterMentionsQueue
    .add(JobType.POLL_TWITTER_MENTIONS, {}, { repeat: { every: pollInterval } })
    .then(() =>
      logger.info('Twitter mentions polling scheduled', { intervalMs: String(pollInterval) })
    )
    .catch((err) => logger.error('Failed to schedule Twitter polling', { error: err.message }));
} else {
  logger.info('Twitter integration not configured — polling disabled');
}

// Set up Telegram bot: webhook (production) or polling (dev)
if (isTelegramBotConfigured()) {
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
} else {
  logger.info('Telegram bot not configured — disabled');
}

// Set up Twitter trend polling if credentials are configured
if (isTwitterConfigured()) {
  const trendInterval = parseInt(process.env.TWITTER_TREND_POLL_INTERVAL_MS || '7200000', 10);
  twitterTrendPollQueue
    .add(JobType.POLL_TWITTER_TRENDS, {}, { repeat: { every: trendInterval } })
    .then(() =>
      logger.info('Twitter trend polling scheduled', { intervalMs: String(trendInterval) })
    )
    .catch((err) => logger.error('Failed to schedule trend polling', { error: err.message }));
} else {
  logger.info('Twitter integration not configured — trend polling disabled');
}

// Schedule weekly email digest (Sunday 10:00 UTC)
emailDigestQueue
  .add(JobType.SEND_EMAIL_DIGEST, {}, { repeat: { pattern: '0 10 * * 0' } })
  .then(() => logger.info('Weekly email digest scheduled', { schedule: 'Sunday 10:00 UTC' }))
  .catch((err) => logger.error('Failed to schedule email digest', { error: err.message }));

// Schedule cleanup every 15 minutes (stale drafts + stuck video generations)
draftCleanupQueue
  .add(JobType.CLEANUP_DRAFTS, {}, { repeat: { every: 15 * 60 * 1000 } })
  .then(() => logger.info('Cleanup scheduled', { intervalMs: '900000' }))
  .catch((err) => logger.error('Failed to schedule cleanup', { error: err.message }));

// Schedule BYOK key re-validation every 24 hours
keyValidationQueue
  .add(JobType.VALIDATE_KEYS, {}, { repeat: { every: 24 * 60 * 60 * 1000 } })
  .then(() => logger.info('BYOK key validation scheduled', { intervalMs: '86400000' }))
  .catch((err) => logger.error('Failed to schedule key validation', { error: err.message }));

// Schedule daily R2 usage collection if Cloudflare API token is configured
if (isR2MonitoringConfigured()) {
  r2UsageQueue
    .add(JobType.COLLECT_R2_USAGE, {}, { repeat: { every: 86400000 } })
    .then(() => logger.info('R2 usage monitoring scheduled', { intervalMs: '86400000' }))
    .catch((err) => logger.error('Failed to schedule R2 usage monitoring', { error: err.message }));
} else {
  logger.info('R2 monitoring not configured — usage collection disabled');
}

// Schedule daily pricing fetch (every 24 hours)
pricingFetchQueue
  .add(JobType.FETCH_PRICING, {}, { repeat: { every: 86400000 } })
  .then(() => logger.info('Pricing fetch scheduled', { intervalMs: '86400000' }))
  .catch((err) => logger.error('Failed to schedule pricing fetch', { error: err.message }));

// Schedule daily ML feature computation catch-up (every 24 hours)
featureComputationQueue
  .add(JobType.COMPUTE_FEATURES, { scope: 'all' }, { repeat: { every: 86400000 } })
  .then(() => logger.info('Feature computation catch-up scheduled', { intervalMs: '86400000' }))
  .catch((err) => logger.error('Failed to schedule feature computation', { error: err.message }));

// Start in-memory pricing refresh interval (picks up DB changes every 5 min)
startPricingRefreshInterval();

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
