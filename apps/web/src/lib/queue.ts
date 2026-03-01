import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { createRedisConnection } from './redis';
import { logger } from './logger';
import { prismaUnfiltered as prisma } from './prisma';
import { markPodcastFailed } from './pipeline-resume';
import { classifyError, isKeyInvalidationError, userMessage } from './byok-errors';
import { markTtsKeyInvalid, markAiKeyInvalid } from './byok';
import type { AiProviderId } from './providers/ai-registry';
import type { TtsProviderId } from './providers/tts-registry';
import type { SttProviderId } from '@sotto/shared';
import { sendMessage as sendTelegram, isTelegramBotConfigured } from './telegram';

/**
 * Job types for the Sotto queue system
 */
export enum JobType {
  EXTRACT_CONTENT = 'extract_content',
  GENERATE_SCRIPT = 'generate_script',
  VERIFY_SCRIPT = 'verify_script',
  VALIDATE_REFERENCES = 'validate_references',
  GENERATE_AUDIO = 'generate_audio',
  STITCH_AUDIO = 'stitch_audio',
  PROCESS_INTERACTION = 'process_interaction',
  REGENERATE_SEGMENT = 'regenerate_segment',
  SEND_NOTIFICATION = 'send_notification',
  GENERATE_PDF = 'generate_pdf',
  POLL_TWITTER_MENTIONS = 'poll_twitter_mentions',
  REPLY_TWITTER = 'reply_twitter',
  IMPORT_AUDIO = 'import_audio',
  INGEST_EVENTS = 'ingest_events',
  COMPUTE_FEATURES = 'compute_features',
  EXPORT_DATA = 'export_data',
  VALIDATE_KEYS = 'validate_keys',
  POLL_TELEGRAM_UPDATES = 'poll_telegram_updates',
  REPLY_TELEGRAM = 'reply_telegram',
  AUTO_TWEET = 'auto_tweet',
  POLL_TWITTER_TRENDS = 'poll_twitter_trends',
  ADMIN_THREAD_TO_PODCAST = 'admin_thread_to_podcast',
  MODERATE_CONTENT = 'moderate_content',
  SEND_EMAIL_DIGEST = 'send_email_digest',
  SEND_ANNOUNCEMENT = 'send_announcement',
  VERIFY_VOICE = 'verify_voice',
  GENERATE_VOICE_TRACK_AUDIO = 'generate_voice_track_audio',
  STITCH_VOICE_TRACK = 'stitch_voice_track',
  CLEANUP_DRAFTS = 'cleanup_drafts',
}

/**
 * Job payload types
 */
export interface ExtractContentPayload {
  podcastId: string;
  userId: string;
  sourceUrl?: string;
  sourceText?: string;
  useAdminCredits?: boolean;
}

export interface GenerateScriptPayload {
  podcastId: string;
  userId: string;
  discoveryId: string;
  sourceContent?: string;
  useAdminCredits?: boolean;
  userFeedback?: string;
  previousTurns?: Array<{ speaker: string; text: string; direction?: string }>;
  previousReferences?: Array<{ number: number; title: string; authors?: string; year?: number; url?: string; type: string; publisher?: string; doi?: string }>;
}

export interface GenerateAudioPayload {
  podcastId: string;
  segmentId: string;
  speaker: string;
  text: string;
  previousText?: string;
  nextText?: string;
  direction?: string;
}

export interface StitchAudioPayload {
  podcastId: string;
  segmentIds: string[];
  skipSfx?: boolean;
}

export interface ProcessInteractionPayload {
  podcastId: string;
  interactionId: string;
  userId: string;
  question: string;
  timestamp: number;
}

export interface RegenerateSegmentPayload {
  podcastId: string;
  interactionId: string;
  insertAfterOrder: number;
  newText: string;
  speaker: string;
}

export interface SendNotificationPayload {
  userId: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, string>;
}

export interface ValidateReferencesPayload {
  podcastId: string;
  userId: string;
  useAdminCredits?: boolean;
}

export interface VerifyVoicePayload {
  voiceCloneId: string;
  userId: string;
  action: 'extract_fingerprint' | 'check_duplicates' | 'verify_challenge';
  challengeId?: string;
}

export interface VerifyScriptPayload {
  podcastId: string;
  userId: string;
  discoveryId: string;
  useAdminCredits?: boolean;
}

export interface GeneratePdfPayload {
  podcastId: string;
  userId: string;
}

export interface PollTwitterMentionsPayload {
  // Empty — repeatable job, no per-invocation data
}

export interface ReplyTwitterPayload {
  podcastId: string;
  tweetMentionId: string;
  originalTweetId: string;
}

export interface ImportAudioPayload {
  podcastId: string;
  userId: string;
  audioKey: string;
  transcriptText?: string;
  isHumanContent: boolean;
  generateMetadata?: boolean;
  sttProvider?: 'openai' | 'elevenlabs' | 'groq' | 'together' | 'deepgram' | 'assemblyai';
  sttModel?: string;
  sttApiKey?: string;
}

export interface IngestEventsPayload {
  ip?: string;
  events: Array<{
    context: {
      sessionId: string;
      userId?: string;
      pageUrl: string;
      deviceType?: string;
      userAgent?: string;
      referrer?: string;
      clientTs: number;
    };
    payload: Record<string, unknown> & { eventType: string };
  }>;
}

export interface ComputeFeaturesPayload {
  scope: 'user' | 'podcast' | 'all';
  targetId?: string;
}

export interface DataExportPayload {
  exportType:
    | 'playback_sessions'
    | 'behavioral_events'
    | 'user_features'
    | 'podcast_features'
    | 'interactions'
    | 'training_pairs';
  dateFrom?: string;
  dateTo?: string;
  format: 'jsonl' | 'csv';
}

export interface ValidateKeysPayload {}

export interface PollTelegramUpdatesPayload {}

export interface ReplyTelegramPayload {
  podcastId: string;
  telegramMessageId?: string;
  chatId: string;
}

export interface AutoTweetPayload {
  podcastId: string;
  trigger: 'threshold' | 'manual' | 'trend';
}

export interface PollTwitterTrendsPayload {}

export interface AdminThreadToPodcastPayload {
  tweetUrl: string;
  adminUserId: string;
  message?: string;
  podcastId?: string;
}

export interface ModerateContentPayload {
  targetType: 'podcast' | 'comment';
  targetId: string;
  content: string;
  userId?: string;
}

export interface AnnouncementPayload {
  subject: string;
  message: string;
}

export interface GenerateVoiceTrackAudioPayload {
  podcastId: string;
  voiceTrackId: string;
  voiceTrackSegmentId: string;
  segmentId: string;
  speaker: string;
  text: string;
}

export interface StitchVoiceTrackPayload {
  podcastId: string;
  voiceTrackId: string;
  voiceTrackSegmentIds: string[];
}

/**
 * Queue configuration
 */
interface QueueConfig {
  attempts?: number;
  backoff?: { type: 'fixed' | 'exponential'; delay: number };
  removeOnComplete?: boolean | { age: number; count?: number };
  removeOnFail?: boolean | { age: number };
}

const DEFAULT_QUEUE_OPTIONS: QueueConfig = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 86400, count: 100 },
  removeOnFail: { age: 604800 },
};

const queueInstances = new Map<string, Queue>();

/**
 * Create or get existing job queue
 */
export function createQueue(name: string, config?: Partial<QueueConfig>): Queue {
  if (queueInstances.has(name)) {
    return queueInstances.get(name)!;
  }

  const connection = createRedisConnection(`queue:${name}`);
  const mergedConfig = { ...DEFAULT_QUEUE_OPTIONS, ...config };

  const queue = new Queue(name, {
    connection,
    defaultJobOptions: {
      attempts: mergedConfig.attempts,
      backoff: mergedConfig.backoff,
      removeOnComplete: mergedConfig.removeOnComplete,
      removeOnFail: mergedConfig.removeOnFail,
    },
  });

  setupQueueEvents(queue, name);
  queueInstances.set(name, queue);

  logger.info(`Queue '${name}' created`);
  return queue;
}

function setupQueueEvents(queue: Queue, queueName: string): void {
  const events = new QueueEvents(queueName, {
    connection: createRedisConnection(`events:${queueName}`),
  });

  events.on('completed', (args) => {
    // Suppress noisy repeating poll jobs (telegram-bot, twitter-mentions, twitter-trend-poll)
    const isRepeat = args.jobId.startsWith('repeat:');
    if (!isRepeat) {
      logger.debug(`Job completed in ${queueName}:`, { jobId: args.jobId });
    }
  });

  events.on('failed', async (args) => {
    logger.error(`Job failed in ${queueName}:`, {
      jobId: args.jobId,
      failedReason: args.failedReason,
    });

    // Centralized failure handler: classify error, invalidate BYOK keys, notify user
    try {
      const job = await queue.getJob(args.jobId);
      const podcastId = (job?.data as Record<string, unknown>)?.podcastId as string | undefined;
      if (!podcastId) return;

      // Log every failure (including retries) as a PipelineEvent
      await prisma.pipelineEvent.create({
        data: {
          podcastId,
          stage: queueName,
          type: job?.attemptsMade != null && job.attemptsMade < (job.opts?.attempts ?? 3) ? 'retry' : 'error',
          message: args.failedReason || 'Unknown failure',
          metadata: {
            jobId: args.jobId,
            attemptNumber: job?.attemptsMade,
            maxAttempts: job?.opts?.attempts,
            segmentId: (job?.data as Record<string, unknown>)?.segmentId as string | undefined,
            errorKind: classifyError(args.failedReason || ''),
          },
        },
      }).catch(err => logger.error('Failed to write PipelineEvent', {
        jobId: args.jobId,
        error: err instanceof Error ? err.message : String(err),
      }));

      // Voice track jobs: handle separately — the podcast is already READY
      const VOICE_TRACK_QUEUES = ['voice-track-audio', 'voice-track-stitching'];
      if (VOICE_TRACK_QUEUES.includes(queueName)) {
        const voiceTrackId = (job?.data as Record<string, unknown>)?.voiceTrackId as string | undefined;
        if (!voiceTrackId) return;

        const errorKind = classifyError(args.failedReason || '');
        const failureReason = userMessage(errorKind, 'the provider');

        const voiceTrack = await prisma.voiceTrack.findUnique({
          where: { id: voiceTrackId },
          select: { podcastId: true, name: true },
        });
        if (!voiceTrack) return;

        await prisma.voiceTrack.update({
          where: { id: voiceTrackId },
          data: { status: 'FAILED', failureReason },
        });

        if (isKeyInvalidationError(errorKind)) {
          const podcast = await prisma.podcast.findUnique({
            where: { id: voiceTrack.podcastId },
            select: { userId: true, ttsProvider: true },
          });
          if (podcast?.ttsProvider) {
            await markTtsKeyInvalid(podcast.userId, podcast.ttsProvider as TtsProviderId);
          }
        }

        const notifQueue = queueInstances.get('notifications');
        if (notifQueue) {
          const podcast = await prisma.podcast.findUnique({
            where: { id: voiceTrack.podcastId },
            select: { userId: true },
          });
          if (podcast) {
            await notifQueue.add('send_notification', {
              userId: podcast.userId,
              type: 'VOICE_TRACK_FAILED',
              title: 'Voice Track Failed',
              message: `Voice track "${voiceTrack.name}" failed: ${failureReason}`,
              data: { podcastId: voiceTrack.podcastId, voiceTrackId },
            });
          }
        }
        return;
      }

      const podcast = await prisma.podcast.findUnique({
        where: { id: podcastId },
        select: {
          status: true, userId: true, title: true, ttsProvider: true,
          source: true, sourceTweetId: true,
          user: { select: { telegramEnabled: true, telegramChatId: true } },
        },
      });
      if (!podcast) return;

      const errorKind = classifyError(args.failedReason || '');
      const notifQueue = queueInstances.get('notifications');

      const TTS_QUEUES = ['audio-generation', 'segment-regeneration', 'voice-track-audio'];
      const AI_QUEUES = ['script-generation', 'script-verification', 'reference-validation'];

      // Handle interaction failures separately — podcast is already READY
      if (queueName === 'interactions') {
        if (isKeyInvalidationError(errorKind)) {
          const aiKey = await prisma.userAiKey.findFirst({
            where: { userId: podcast.userId, isValid: true },
          });
          if (aiKey) {
            await markAiKeyInvalid(podcast.userId, aiKey.provider as AiProviderId);
            if (notifQueue) {
              await notifQueue.add('send_notification', {
                userId: podcast.userId,
                type: 'KEY_INVALID',
                title: 'API Key Invalid',
                message: userMessage(errorKind, aiKey.provider),
                data: { podcastId },
              });
            }
          }
        }
        return;
      }

      // Skip already-terminal states
      if (podcast.status === 'READY' || podcast.status === 'FAILED' || podcast.status === 'SCRIPT_READY' || podcast.status === 'DRAFT') return;

      // Only notify + mark failed on terminal failures (all retries exhausted).
      // Non-terminal retries are logged as PipelineEvents above but don't alert.
      const maxAttempts = job?.opts?.attempts ?? 3;
      const isTerminal = job?.attemptsMade != null && job.attemptsMade >= maxAttempts;
      if (!isTerminal) return;

      // Determine provider label and attempt key invalidation
      let failureReason = userMessage(errorKind, 'the provider');

      if (isKeyInvalidationError(errorKind)) {
        if (TTS_QUEUES.includes(queueName) && podcast.ttsProvider) {
          // BYOK TTS key was used (ttsProvider is set)
          await markTtsKeyInvalid(podcast.userId, podcast.ttsProvider as TtsProviderId);
          failureReason = userMessage(errorKind, podcast.ttsProvider);
          // Clear locked provider so retry can auto-resolve or user can pick a different one
          await prisma.podcast.update({
            where: { id: podcastId },
            data: { ttsProvider: null, ttsModel: null },
          });
          if (notifQueue) {
            await notifQueue.add('send_notification', {
              userId: podcast.userId,
              type: 'KEY_INVALID',
              title: 'API Key Invalid',
              message: failureReason,
              data: { podcastId },
            });
          }
        } else if (AI_QUEUES.includes(queueName)) {
          const aiKey = await prisma.userAiKey.findFirst({
            where: { userId: podcast.userId, isValid: true },
          });
          if (aiKey) {
            await markAiKeyInvalid(podcast.userId, aiKey.provider as AiProviderId);
            failureReason = userMessage(errorKind, aiKey.provider);
            if (notifQueue) {
              await notifQueue.add('send_notification', {
                userId: podcast.userId,
                type: 'KEY_INVALID',
                title: 'API Key Invalid',
                message: failureReason,
                data: { podcastId },
              });
            }
          }
        } else if (queueName === 'audio-import') {
          // STT key: elevenlabs uses TTS key store; all others use AI key store
          const sttProvider = ((job?.data as Record<string, unknown>)?.sttProvider ?? 'openai') as SttProviderId;
          if (sttProvider === 'elevenlabs') {
            await markTtsKeyInvalid(podcast.userId, 'elevenlabs');
            failureReason = userMessage(errorKind, 'ElevenLabs');
          } else {
            await markAiKeyInvalid(podcast.userId, sttProvider as AiProviderId);
            failureReason = userMessage(errorKind, sttProvider);
          }
          if (notifQueue) {
            await notifQueue.add('send_notification', {
              userId: podcast.userId,
              type: 'KEY_INVALID',
              title: 'API Key Invalid',
              message: failureReason,
              data: { podcastId },
            });
          }
        }
      }

      await markPodcastFailed(podcastId, {
        failureReason,
        technicalError: args.failedReason ?? undefined,
      });

      // Queue a podcast failure notification
      if (notifQueue) {
        await notifQueue.add('send_notification', {
          userId: podcast.userId,
          type: 'PODCAST_FAILED',
          title: 'Generation Failed',
          message: failureReason,
          data: { podcastId },
        });
      }

      // Notify all admins: in-app bell + Telegram
      const podcastLabel = podcast.title || podcastId;
      const techError = args.failedReason || 'Unknown error';
      const adminUsers = await prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true, telegramChatId: true },
      });
      const adminMessage = `[${queueName}] ${podcastLabel} — ${errorKind}`;
      for (const admin of adminUsers) {
        // In-app notification (bell)
        if (notifQueue) {
          notifQueue.add('send_notification', {
            userId: admin.id,
            type: 'PIPELINE_FAILURE',
            title: 'Pipeline Failure',
            message: adminMessage,
            data: { podcastId },
          }).catch((err: unknown) => {
            logger.warn('Failed to queue admin pipeline-failure notification', { adminId: admin.id, error: err instanceof Error ? err.message : String(err) });
          });
        }
        // Telegram alert
        if (admin.telegramChatId && isTelegramBotConfigured()) {
          const telegramText = [
            `🚨 *Pipeline Failure*`,
            `*Queue:* ${queueName}`,
            `*Podcast:* ${podcastLabel}`,
            `*Error:* ${errorKind}`,
            `\`${techError.substring(0, 500)}\``,
          ].join('\n');
          sendTelegram(admin.telegramChatId, telegramText, { parse_mode: 'Markdown' }).catch((err: unknown) => {
            logger.warn('Failed to send admin pipeline-failure Telegram', { adminId: admin.id, error: err instanceof Error ? err.message : String(err) });
          });
        }
      }

      // Queue Twitter failure reply for Twitter-sourced podcasts
      if (podcast.source === 'TWITTER' && podcast.sourceTweetId) {
        const twitterReplyQ = queueInstances.get('twitter-reply');
        if (twitterReplyQ) {
          const mention = await prisma.tweetMention.findFirst({
            where: { podcastId, status: { in: ['GENERATING', 'READY'] } },
            select: { id: true, tweetId: true },
          }).catch(() => null);
          if (mention) {
            await twitterReplyQ.add('reply_twitter', {
              podcastId,
              tweetMentionId: mention.id,
              originalTweetId: mention.tweetId,
            }, { jobId: `twitter-fail-${podcastId}` }).catch(() => {});
          }
        }
      }

      // Queue Telegram failure reply for users with Telegram enabled
      if (podcast.user?.telegramEnabled && podcast.user?.telegramChatId) {
        const telegramReplyQ = queueInstances.get('telegram-reply');
        if (telegramReplyQ) {
          const tgMsg = await prisma.telegramMessage.findFirst({
            where: { podcastId, status: { in: ['GENERATING', 'READY'] } },
            select: { id: true, chatId: true },
          }).catch(() => null);
          await telegramReplyQ.add('reply_telegram', {
            podcastId,
            telegramMessageId: tgMsg?.id,
            chatId: tgMsg?.chatId ?? podcast.user.telegramChatId,
          }, { jobId: `telegram-fail-${podcastId}` }).catch(() => {});
        }
      }

      logger.info('Marked podcast as FAILED after generation failure', {
        userId: podcast.userId,
        podcastId,
        errorKind,
        failureReason,
      });
    } catch (err) {
      logger.error('Failed to process failure handler', {
        jobId: args.jobId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  events.on('error', (err) => {
    logger.error(`Queue ${queueName} error:`, { error: err.message });
  });
}

/**
 * Add job to queue
 */
export async function addJob<T>(
  queue: Queue,
  jobType: JobType,
  payload: T,
  options?: { priority?: number; delay?: number; attempts?: number; jobId?: string }
): Promise<Job<T>> {
  const job = await queue.add(jobType, payload, {
    priority: options?.priority,
    delay: options?.delay,
    attempts: options?.attempts,
    jobId: options?.jobId,
  });

  logger.info(`Job added to queue: ${queue.name}`, { jobId: job.id, jobType });
  return job;
}

/**
 * Create worker for processing jobs
 */
export function createWorker<T>(
  queueName: string,
  processor: (job: Job<T>) => Promise<unknown>,
  config?: { concurrency?: number; lockDuration?: number }
): Worker<T> {
  const connection = createRedisConnection(`worker:${queueName}`);

  const worker = new Worker<T>(queueName, processor, {
    connection,
    concurrency: config?.concurrency || 3,
    lockDuration: config?.lockDuration || 30000,
  });

  worker.on('ready', () => logger.info(`Worker ready for ${queueName}`));
  worker.on('error', (err) =>
    logger.error(`Worker error for ${queueName}:`, { error: err.message })
  );
  worker.on('failed', (job, err) =>
    logger.error(`Worker job failed for ${queueName}:`, { jobId: job?.id, error: err.message })
  );

  return worker;
}

/**
 * Predefined queues
 */
export const contentExtractionQueue = createQueue('content-extraction', { attempts: 3 });
export const scriptGenerationQueue = createQueue('script-generation', { attempts: 3 });
export const audioGenerationQueue = createQueue('audio-generation', { attempts: 3 });
export const audioStitchingQueue = createQueue('audio-stitching', { attempts: 2 });
export const interactionQueue = createQueue('interactions', { attempts: 3 });
export const segmentRegenerationQueue = createQueue('segment-regeneration', { attempts: 2 });
export const notificationQueue = createQueue('notifications', { attempts: 5 });
export const referenceValidationQueue = createQueue('reference-validation', { attempts: 2 });
export const pdfGenerationQueue = createQueue('pdf-generation', { attempts: 2 });
export const scriptVerificationQueue = createQueue('script-verification', { attempts: 2 });
export const twitterMentionsQueue = createQueue('twitter-mentions', { attempts: 1 });
export const twitterReplyQueue = createQueue('twitter-reply', { attempts: 3 });
export const eventIngestionQueue = createQueue('event-ingestion', {
  attempts: 2,
  removeOnComplete: { age: 3600, count: 500 },
});
export const audioImportQueue = createQueue('audio-import', { attempts: 2 });
export const featureComputationQueue = createQueue('feature-computation', { attempts: 2 });
export const dataExportQueue = createQueue('data-export', { attempts: 2 });
export const keyValidationQueue = createQueue('key-validation', { attempts: 1 });
export const telegramBotQueue = createQueue('telegram-bot', { attempts: 1 });
export const telegramReplyQueue = createQueue('telegram-reply', { attempts: 3 });
export const twitterAutoTweetQueue = createQueue('twitter-auto-tweet', { attempts: 3 });
export const twitterTrendPollQueue = createQueue('twitter-trend-poll', { attempts: 1 });
export const adminThreadToPodcastQueue = createQueue('admin-thread-to-podcast', { attempts: 2 });
export const contentModerationQueue = createQueue('content-moderation', { attempts: 2 });
export const emailDigestQueue = createQueue('email-digest', { attempts: 2 });
export const announcementQueue = createQueue('announcements', { attempts: 2 });
export const voiceVerificationQueue = createQueue('voice-verification', { attempts: 2 });
export const voiceTrackAudioQueue = createQueue('voice-track-audio', { attempts: 3 });
export const voiceTrackStitchingQueue = createQueue('voice-track-stitching', { attempts: 2 });
export const draftCleanupQueue = createQueue('draft-cleanup', { attempts: 1 });

/** All queue names — single source of truth for admin and health endpoints */
export const ALL_QUEUE_NAMES = [
  'content-extraction',
  'script-generation',
  'script-verification',
  'reference-validation',
  'audio-generation',
  'audio-stitching',
  'interactions',
  'segment-regeneration',
  'notifications',
  'pdf-generation',
  'twitter-mentions',
  'twitter-reply',
  'event-ingestion',
  'audio-import',
  'feature-computation',
  'data-export',
  'key-validation',
  'telegram-bot',
  'telegram-reply',
  'twitter-auto-tweet',
  'twitter-trend-poll',
  'admin-thread-to-podcast',
  'content-moderation',
  'email-digest',
  'announcements',
  'voice-verification',
  'voice-track-audio',
  'voice-track-stitching',
  'draft-cleanup',
] as const;
