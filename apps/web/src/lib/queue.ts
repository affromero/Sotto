import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { createRedisConnection } from './redis';
import { logger } from './logger';
import { prisma } from './prisma';

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
}

/**
 * Job payload types
 */
export interface ExtractContentPayload {
  podcastId: string;
  userId: string;
  sourceUrl?: string;
  sourceText?: string;
}

export interface GenerateScriptPayload {
  podcastId: string;
  userId: string;
  discoveryId: string;
  sourceContent?: string;
}

export interface GenerateAudioPayload {
  podcastId: string;
  segmentId: string;
  speaker: 'HOST' | 'EXPERT';
  text: string;
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
  speaker: 'HOST' | 'EXPERT';
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
}

export interface VerifyScriptPayload {
  podcastId: string;
  userId: string;
  discoveryId: string;
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
}

export interface IngestEventsPayload {
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
    logger.info(`Job completed in ${queueName}:`, { jobId: args.jobId });
  });

  events.on('failed', async (args) => {
    logger.error(`Job failed in ${queueName}:`, {
      jobId: args.jobId,
      failedReason: args.failedReason,
    });

    // Centralized failure handler: mark podcast as FAILED and notify user
    try {
      const job = await queue.getJob(args.jobId);
      const podcastId = (job?.data as Record<string, unknown>)?.podcastId as string | undefined;
      if (!podcastId) return;

      const podcast = await prisma.podcast.findUnique({
        where: { id: podcastId },
        select: { status: true, userId: true, title: true },
      });

      if (!podcast || podcast.status === 'READY' || podcast.status === 'FAILED') return;

      await prisma.podcast.update({
        where: { id: podcastId },
        data: { status: 'FAILED' },
      });

      // Queue a notification
      const notifQueue = queueInstances.get('notifications');
      if (notifQueue) {
        await notifQueue.add('send_notification', {
          userId: podcast.userId,
          type: 'PODCAST_READY',
          title: 'Generation Failed',
          message: 'Your podcast generation failed. Please try again.',
          data: { podcastId },
        });
      }

      logger.info('Marked podcast as FAILED after generation failure', {
        userId: podcast.userId,
        podcastId,
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
  options?: { priority?: number; delay?: number; attempts?: number }
): Promise<Job<T>> {
  const job = await queue.add(jobType, payload, {
    priority: options?.priority,
    delay: options?.delay,
    attempts: options?.attempts,
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
