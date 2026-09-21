import { ConnectionOptions, Queue, Worker, Job } from 'bullmq';
import { validateSottoQueueContract } from '@/lib/sidedoor/jobs/core/job-contracts';
import { executeSottoJob } from '@/lib/sidedoor/jobs/core/job-execution';
import {
  admitDurableQueueJob,
  bindDurableQueueJob,
  bindDurableQueueCleanup,
  completeDurableQueueJob,
  loadDurableQueueJob,
  isDurableQueueCleanupFailure,
  reconcileDurableQueueFailure,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import { deliverSottoJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { withSottoJobExecution } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { createRedisConnection, getSharedQueueRedisClient } from './redis';
import { logger } from './logger';
import { prismaUnfiltered as prisma } from './prisma';
import type { Prisma } from '@/generated/prisma/client';

/**
 * Job types for the Sotto queue system
 */
export enum JobType {
  EXTRACT_CONTENT = 'extract_content',
  DEEP_RESEARCH = 'deep_research',
  CREATIVE_PLANNING = 'creative_planning',
  WRITE_SCRIPT = 'write_script',
  COMPILE_SCRIPT = 'compile_script',
  GENERATE_AUDIO = 'generate_audio',
  PROCESS_INTERACTION = 'process_interaction',
  SEND_NOTIFICATION = 'send_notification',
  VALIDATE_KEYS = 'validate_keys',
  FETCH_PRICING = 'fetch_pricing',
  SPEAKING_GRADING = 'speaking_grading',
  WORKSHEET_PDF = 'worksheet_pdf',
}

/**
 * Job payload types
 */
export interface ExtractContentPayload {
  episodeId: string;
  userId: string;
  sourceUrl?: string;
  sourceText?: string;
  allowSharedCredential?: boolean;
}

export interface GenerateScriptPayload {
  episodeId: string;
  userId: string;
  discoveryId: string;
  sourceContent?: string;
  allowSharedCredential?: boolean;
  userFeedback?: string;
  previousTurns?: Array<{ speaker: string; text: string; direction?: string }>;
  previousReferences?: Array<{
    number: number;
    title: string;
    authors?: string;
    year?: number;
    url?: string;
    type: string;
    publisher?: string;
    doi?: string;
  }>;
  sourceUrls?: string[];
}

export interface GenerateAudioPayload {
  episodeId: string;
  audioGenerationKey: string;
  segmentId: string;
  segmentVersion: number;
  speaker: string;
  text: string;
  previousText?: string;
  nextText?: string;
  direction?: string;
}

export interface ProcessInteractionPayload {
  episodeId: string;
  interactionId: string;
  userId: string;
  question: string;
  timestamp: number;
}

export interface SendNotificationPayload {
  notificationId?: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, string>;
}

export interface ValidateReferencesPayload {
  episodeId: string;
  userId: string;
  allowSharedCredential?: boolean;
  referenceRetryAttempt?: number; // 0-based, undefined = first pass
  previousVerifiedCount?: number; // for early termination (going backward = stop)
  previouslyVerifiedRefIds?: string[]; // skip re-verification on retry
}

export interface DeepResearchPayload {
  episodeId: string;
  userId: string;
  discoveryId: string;
  allowSharedCredential?: boolean;
}

export interface CreativePlanningPayload {
  episodeId: string;
  userId: string;
  discoveryId: string;
  dossierId: string;
  allowSharedCredential?: boolean;
}

export interface WriteScriptPayload {
  episodeId: string;
  userId: string;
  discoveryId: string;
  dossierId: string;
  outlineId: string;
  allowSharedCredential?: boolean;
  sourceUrls?: string[];
}

export interface CompileScriptPayload {
  episodeId: string;
  userId: string;
  allowSharedCredential?: boolean;
}

export interface ValidateKeysPayload {}

export interface CollectR2UsagePayload {}

export interface FetchPricingPayload {}

export interface MonitorTtsProvidersPayload {}

/**
 * Queue configuration
 */
interface QueueConfig {
  attempts?: number;
  backoff?: { type: 'fixed' | 'exponential'; delay: number };
  removeOnComplete?: boolean | { age: number; count?: number };
  removeOnFail?: boolean | { age: number };
}

interface QueueDefinition extends QueueConfig {
  skipEvents?: boolean;
}

const DEFAULT_QUEUE_OPTIONS: QueueConfig = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 86400, count: 100 },
  removeOnFail: { age: 604800 },
};

const QUEUE_DEFINITIONS: Record<string, QueueDefinition> = {
  'content-extraction': { attempts: 3 },
  'deep-research': { attempts: 3 },
  'creative-planning': { attempts: 3 },
  'script-writing': { attempts: 3 },
  'compile-script': { attempts: 3 },
  'audio-generation': { attempts: 3 },
  'audio-stitching': { attempts: 2 },
  interactions: { attempts: 3 },
  'segment-regeneration': { attempts: 2 },
  notifications: { attempts: 5, skipEvents: true },
  'pdf-generation': { attempts: 2, skipEvents: true },
  'key-validation': { attempts: 1, skipEvents: true },
  'pricing-fetch': { attempts: 2, skipEvents: true },
  'waveform-generation': { attempts: 2, skipEvents: true },
  'episode-status': { attempts: 3, skipEvents: true },
  'speaking-grading': { attempts: 3 },
  'worksheet-pdf': { attempts: 2, skipEvents: true },
};

const queueInstances = new Map<string, Queue>();
const queueReferences = new Map<string, Queue>();

function getQueueDefinition(name: string, config?: QueueDefinition): QueueDefinition {
  return {
    ...DEFAULT_QUEUE_OPTIONS,
    ...(QUEUE_DEFINITIONS[name] ?? {}),
    ...config,
  };
}

/**
 * Create or get existing job queue
 */
export function createQueue(name: string, config?: QueueDefinition): Queue {
  if (queueInstances.has(name)) {
    return queueInstances.get(name)!;
  }

  const mergedConfig = getQueueDefinition(name, config);

  const queue = new Queue(name, {
    connection: getSharedQueueRedisClient() as unknown as ConnectionOptions,
    defaultJobOptions: {
      attempts: mergedConfig.attempts,
      backoff: mergedConfig.backoff,
      removeOnComplete: mergedConfig.removeOnComplete,
      removeOnFail: mergedConfig.removeOnFail,
    },
  });

  queueInstances.set(name, queue);

  logger.info(`Queue '${name}' created`);
  return queue;
}

/** A dispatcher owns its connection so cancellation can reject in-flight Redis commands. */
export async function withDispatchQueue<Result>(
  name: string,
  signal: AbortSignal,
  operation: (queue: Queue) => Promise<Result>
): Promise<Result> {
  signal.throwIfAborted();
  if (!name || name.includes(':')) throw new Error('Invalid dispatcher queue name');
  const config = getQueueDefinition(name);
  const client = createRedisConnection(`dispatch:${name}`, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 10_000,
    retryStrategy: () => null,
  });
  let queue: Queue | undefined;
  const abort = () => client.disconnect();
  // Cut off this Redis transport; an already proven database acknowledgement may still finish.
  const timer = setTimeout(abort, 15_000);
  signal.addEventListener('abort', abort, { once: true });
  try {
    queue = new Queue(name, {
      connection: client as unknown as ConnectionOptions,
      defaultJobOptions: {
        attempts: config.attempts,
        backoff: config.backoff,
        removeOnComplete: config.removeOnComplete,
        removeOnFail: config.removeOnFail,
      },
    });
    if (signal.aborted) abort();
    await queue.waitUntilReady();
    signal.throwIfAborted();
    return await operation(queue);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    client.disconnect();
    await queue?.close();
  }
}

function logJobCompleted(queueName: string, job: Job<unknown>): void {
  const jobId = String(job.id);
  if (!jobId.startsWith('repeat:')) {
    logger.debug(`Job completed in ${queueName}:`, { jobId });
  }
}

function logWorkerError(queueName: string, err: Error): void {
  logger.error(`Worker error for ${queueName}:`, { error: err.message });
}

function logWorkerJobFailure(queueName: string, job: Job<unknown> | undefined, err: Error): void {
  logger.error(`Worker job failed for ${queueName}:`, {
    jobId: job?.id,
    error: err.message,
  });
}

function genericContractVersion(queueName: string, jobName: string): number | null {
  if (queueName === 'notifications') return jobName === 'notifications.v4' ? 4 : null;
  return new Set([
    'content-extraction',
    'deep-research',
    'creative-planning',
    'script-writing',
    'compile-script',
    'audio-generation',
    'interactions',
    'pricing-fetch',
  ]).has(queueName)
    ? 1
    : null;
}

function createQueueReference(name: string): Queue {
  if (queueReferences.has(name)) {
    return queueReferences.get(name)!;
  }

  const reference = new Proxy({} as Queue, {
    get(_target, prop) {
      const queue = createQueue(name);
      const value = Reflect.get(queue as object, prop);
      return typeof value === 'function' ? value.bind(queue) : value;
    },
    set(_target, prop, value) {
      const queue = createQueue(name);
      Reflect.set(queue as object, prop, value);
      return true;
    },
    has(_target, prop) {
      return prop in createQueue(name);
    },
    ownKeys() {
      return Reflect.ownKeys(createQueue(name) as object);
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Object.getOwnPropertyDescriptor(createQueue(name) as object, prop);
    },
  }) as Queue;

  queueReferences.set(name, reference);
  return reference;
}

export async function admitDurableJob<T>(
  queue: Queue,
  jobType: JobType,
  payload: T,
  options: {
    jobId: string;
    authorize: (database: Prisma.TransactionClient) => Promise<{ userId?: string } | void>;
    mutate: (database: Prisma.TransactionClient, operationId: string) => Promise<void>;
    priority?: number;
    attempts?: number;
  }
): Promise<Job<T>> {
  const definition = getQueueDefinition(queue.name);
  return admitDurableQueueJob({
    queue,
    type: jobType,
    payload,
    jobId: options.jobId,
    authorize: options.authorize,
    mutate: options.mutate,
    priority: options.priority,
    attempts: options.attempts ?? definition.attempts,
  });
}

/**
 * Create worker for processing jobs
 */
export function createWorker<T>(
  queueName: string,
  processor: (job: Job<T>, signal?: AbortSignal, token?: string) => Promise<unknown>,
  config?: { concurrency?: number; lockDuration?: number }
): Worker<T> {
  const queueDefinition = getQueueDefinition(queueName);
  const connection = createRedisConnection(`worker:${queueName}`) as unknown as ConnectionOptions;

  const worker = new Worker<T>(
    queueName,
    async (job, token, signal) => {
      validateSottoQueueContract(queueName, job);
      const genericVersion = genericContractVersion(queueName, job.name);
      if (genericVersion === null) return executeSottoJob(job, processor, token, signal);
      const work = await sottoTransaction(prisma, (database) =>
        loadDurableQueueJob<T>(database, job as Job<unknown>, queueName, genericVersion)
      );
      if (work.complete) return;
      const bound = bindDurableQueueJob(job as Job<unknown>, work.payload.payload, work);
      const executionSignal = signal ?? new AbortController().signal;
      return executeSottoJob(
        bound,
        () =>
          withSottoJobExecution({
            database: prisma,
            parentId: work.operationId,
            fingerprint: work.fingerprint,
            signal: executionSignal,
            isCleanupFailure: isDurableQueueCleanupFailure,
            validate: async (database) => {
              const current = await loadDurableQueueJob<T>(
                database,
                job as Job<unknown>,
                queueName,
                genericVersion
              );
              return !current.complete;
            },
            run: async ({ markCleanupUnconfirmed }) => {
              bindDurableQueueCleanup(bound, markCleanupUnconfirmed);
              const result = await processor(bound, executionSignal, token);
              await sottoTransaction(prisma, (database) =>
                completeDurableQueueJob(database, bound)
              );
              return result;
            },
          }),
        token,
        executionSignal
      );
    },
    {
      connection,
      concurrency: config?.concurrency || 3,
      lockDuration: config?.lockDuration || 30000,
    }
  );

  worker.on('ready', () => logger.info(`Worker ready for ${queueName}`));
  worker.on('error', (err) => logWorkerError(queueName, err));
  worker.on('completed', (job) => {
    if (!queueDefinition.skipEvents) {
      logJobCompleted(queueName, job as Job<unknown>);
    }
  });
  worker.on('failed', (job, err) => {
    logWorkerJobFailure(queueName, job as Job<unknown> | undefined, err);
    if (!job || job.attemptsMade < (job.opts.attempts ?? queueDefinition.attempts ?? 1)) return;
    const version = genericContractVersion(queueName, job.name);
    if (version === null) return;
    void reconcileDurableQueueFailure({
      database: prisma,
      job: job as Job<unknown>,
      handler: queueName,
      version,
      failedReason: err.message,
    })
      .then(async (notification) => {
        if (!notification) return;
        await deliverSottoJob({
          database: prisma,
          queue: createQueue('notifications'),
          ...notification,
        });
      })
      .catch((failureError) =>
        logger.error('Durable terminal failure reconciliation failed', {
          queueName,
          jobId: job.id,
          error: failureError instanceof Error ? failureError.message : String(failureError),
        })
      );
  });

  return worker;
}

/**
 * Predefined queues
 */
export const contentExtractionQueue = createQueueReference('content-extraction');
export const deepResearchQueue = createQueueReference('deep-research');
export const creativePlanningQueue = createQueueReference('creative-planning');
export const scriptWritingQueue = createQueueReference('script-writing');
export const compileScriptQueue = createQueueReference('compile-script');
export const audioGenerationQueue = createQueueReference('audio-generation');
export const audioStitchingQueue = createQueueReference('audio-stitching');
export const interactionQueue = createQueueReference('interactions');
export const segmentRegenerationQueue = createQueueReference('segment-regeneration');
export const notificationQueue = createQueueReference('notifications');
export const pdfGenerationQueue = createQueueReference('pdf-generation');
export const keyValidationQueue = createQueueReference('key-validation');
export const pricingFetchQueue = createQueueReference('pricing-fetch');

export interface SpeakingGradingPayload {
  recordingId: string;
}

export interface WorksheetPdfPayload {
  classId: string;
  appBaseUrl?: string;
}

export const waveformGenerationQueue = createQueueReference('waveform-generation');
export const episodeStatusQueue = createQueueReference('episode-status');
export const speakingGradingQueue = createQueueReference('speaking-grading');
export const worksheetPdfQueue = createQueueReference('worksheet-pdf');

/** All queue names — single source of truth for admin and health endpoints */
export const ALL_QUEUE_NAMES = Object.freeze(Object.keys(QUEUE_DEFINITIONS));
