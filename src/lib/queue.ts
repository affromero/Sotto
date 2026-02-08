import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { createRedisConnection } from './redis';
import { logger } from './logger';

/**
 * Job types for the Sotto queue system
 */
export enum JobType {
  EXTRACT_CONTENT = 'extract_content',
  GENERATE_SCRIPT = 'generate_script',
  VALIDATE_REFERENCES = 'validate_references',
  GENERATE_AUDIO = 'generate_audio',
  STITCH_AUDIO = 'stitch_audio',
  PROCESS_INTERACTION = 'process_interaction',
  REGENERATE_SEGMENT = 'regenerate_segment',
  SEND_NOTIFICATION = 'send_notification',
  GENERATE_PDF = 'generate_pdf',
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

export interface GeneratePdfPayload {
  podcastId: string;
  userId: string;
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

function setupQueueEvents(_queue: Queue, queueName: string): void {
  const events = new QueueEvents(queueName, {
    connection: createRedisConnection(`events:${queueName}`),
  });

  events.on('completed', (args) => {
    logger.info(`Job completed in ${queueName}:`, { jobId: args.jobId });
  });

  events.on('failed', (args) => {
    logger.error(`Job failed in ${queueName}:`, {
      jobId: args.jobId,
      failedReason: args.failedReason,
    });
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
  worker.on('error', (err) => logger.error(`Worker error for ${queueName}:`, { error: err.message }));
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
