import { ConnectionOptions, Queue, Worker, Job } from 'bullmq';
import { createRedisConnection, getSharedQueueRedisClient } from './redis';
import { logger } from './logger';
import { prismaUnfiltered as prisma } from './prisma';
import { markEpisodeFailed } from './pipeline-resume';
import { classifyError, isKeyInvalidationError, userMessage } from './byok-errors';
import { markTtsKeyInvalid, markAiKeyInvalid } from './byok';
import type { AiProviderId } from './providers/ai-registry';
import type { TtsProviderId } from './providers/tts-registry';

/**
 * Job types for the Sotto queue system
 */
export enum JobType {
  EXTRACT_CONTENT = 'extract_content',
  DEEP_RESEARCH = 'deep_research',
  CREATIVE_PLANNING = 'creative_planning',
  WRITE_SCRIPT = 'write_script',
  COMPILE_SCRIPT = 'compile_script',
  GENERATE_SCRIPT = 'generate_script',
  GENERATE_AUDIO = 'generate_audio',
  STITCH_AUDIO = 'stitch_audio',
  PROCESS_INTERACTION = 'process_interaction',
  REGENERATE_SEGMENT = 'regenerate_segment',
  SEND_NOTIFICATION = 'send_notification',
  GENERATE_PDF = 'generate_pdf',
  VALIDATE_KEYS = 'validate_keys',
  FETCH_PRICING = 'fetch_pricing',
  GENERATE_WAVEFORM = 'generate_waveform',
  MONITOR_TTS_PROVIDERS = 'monitor_tts_providers',
  SPEAKING_GRADING = 'speaking_grading',
  WORKSHEET_PDF = 'worksheet_pdf',
  VERIFY_CLASS_REFERENCES = 'verify_class_references',
}

/**
 * Job payload types
 */
export interface ExtractContentPayload {
  episodeId: string;
  userId: string;
  sourceUrl?: string;
  sourceText?: string;
  useAdminCredits?: boolean;
}

export interface GenerateScriptPayload {
  episodeId: string;
  userId: string;
  discoveryId: string;
  sourceContent?: string;
  useAdminCredits?: boolean;
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
  segmentId: string;
  speaker: string;
  text: string;
  previousText?: string;
  nextText?: string;
  direction?: string;
}

export interface StitchAudioPayload {
  episodeId: string;
  segmentIds: string[];
  skipSfx?: boolean;
}

export interface ProcessInteractionPayload {
  episodeId: string;
  interactionId: string;
  userId: string;
  question: string;
  timestamp: number;
}

export interface RegenerateSegmentPayload {
  episodeId: string;
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
  episodeId: string;
  userId: string;
  useAdminCredits?: boolean;
  referenceRetryAttempt?: number; // 0-based, undefined = first pass
  previousVerifiedCount?: number; // for early termination (going backward = stop)
  previouslyVerifiedRefIds?: string[]; // skip re-verification on retry
}

export interface DeepResearchPayload {
  episodeId: string;
  userId: string;
  discoveryId: string;
  useAdminCredits?: boolean;
}

export interface CreativePlanningPayload {
  episodeId: string;
  userId: string;
  discoveryId: string;
  dossierId: string;
  useAdminCredits?: boolean;
}

export interface WriteScriptPayload {
  episodeId: string;
  userId: string;
  discoveryId: string;
  dossierId: string;
  outlineId: string;
  useAdminCredits?: boolean;
  sourceUrls?: string[];
}

export interface CompileScriptPayload {
  episodeId: string;
  userId: string;
}

export interface GeneratePdfPayload {
  episodeId: string;
  userId: string;
}

export interface ValidateKeysPayload {}

export interface CollectR2UsagePayload {}

export interface FetchPricingPayload {}

export interface MonitorTtsProvidersPayload {}

export interface GenerateWaveformPayload {
  episodeId: string;
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
  'script-generation': { attempts: 3 },
  'audio-generation': { attempts: 3 },
  'audio-stitching': { attempts: 2 },
  interactions: { attempts: 3 },
  'segment-regeneration': { attempts: 2 },
  notifications: { attempts: 5, skipEvents: true },
  'pdf-generation': { attempts: 2, skipEvents: true },
  'key-validation': { attempts: 1, skipEvents: true },
  'pricing-fetch': { attempts: 2, skipEvents: true },
  'waveform-generation': { attempts: 2, skipEvents: true },
  'tts-provider-monitor': { attempts: 2, skipEvents: true },
  'speaking-grading': { attempts: 3 },
  'worksheet-pdf': { attempts: 2, skipEvents: true },
  'verify-class-references': { attempts: 2, skipEvents: true },
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

async function handleWorkerFailure(
  queueName: string,
  job: Job<unknown> | undefined,
  failedReason: string
): Promise<void> {
  const jobId = job?.id != null ? String(job.id) : undefined;

  try {
    const episodeId = (job?.data as Record<string, unknown> | undefined)?.episodeId as
      | string
      | undefined;
    if (!episodeId) {
      return;
    }

    await prisma.pipelineEvent
      .create({
        data: {
          episodeId,
          stage: queueName,
          type:
            job?.attemptsMade != null && job.attemptsMade < (job.opts?.attempts ?? 3)
              ? 'retry'
              : 'error',
          message: failedReason || 'Unknown failure',
          metadata: {
            jobId,
            attemptNumber: job?.attemptsMade,
            maxAttempts: job?.opts?.attempts,
            segmentId: (job?.data as Record<string, unknown> | undefined)?.segmentId as
              | string
              | undefined,
            errorKind: classifyError(failedReason || ''),
          },
        },
      })
      .catch((err) =>
        logger.error('Failed to write PipelineEvent', {
          jobId,
          error: err instanceof Error ? err.message : String(err),
        })
      );

    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: {
        status: true,
        userId: true,
        title: true,
        ttsProvider: true,
        source: true,
        user: { select: { name: true, email: true } },
      },
    });
    if (!episode) {
      return;
    }

    const errorKind = classifyError(failedReason || '');
    const notifQueue = createQueue('notifications');
    const ownerLabel = episode.user?.name || episode.user?.email || episode.userId;

    const TTS_QUEUES = ['audio-generation', 'segment-regeneration'];
    const AI_QUEUES = ['script-generation'];

    if (queueName === 'interactions') {
      if (isKeyInvalidationError(errorKind)) {
        const aiKey = await prisma.userAiKey.findFirst({
          where: { userId: episode.userId, isValid: true },
        });
        if (aiKey) {
          await markAiKeyInvalid(episode.userId, aiKey.provider as AiProviderId);
          if (notifQueue) {
            await notifQueue.add('send_notification', {
              userId: episode.userId,
              type: 'KEY_INVALID',
              title: 'API Key Invalid',
              message: userMessage(errorKind, aiKey.provider),
              data: { episodeId },
            });
          }
        }
      }
      return;
    }

    if (
      episode.status === 'READY' ||
      episode.status === 'FAILED' ||
      episode.status === 'SCRIPT_READY'
    ) {
      return;
    }

    const maxAttempts = job?.opts?.attempts ?? QUEUE_DEFINITIONS[queueName]?.attempts ?? 3;
    const isTerminal = !job || (job.attemptsMade != null && job.attemptsMade >= maxAttempts);
    if (!isTerminal) {
      return;
    }

    const STAGE_LABELS: Record<string, string> = {
      'content-extraction': 'Content extraction',
      'script-generation': 'Script generation',
      'audio-generation': 'Audio generation',
      'audio-stitching': 'Audio stitching',
      'segment-regeneration': 'Segment regeneration',
    };
    const stageLabel = STAGE_LABELS[queueName] || 'Generation';
    let failureReason = userMessage(errorKind, 'the provider', stageLabel);

    if (isKeyInvalidationError(errorKind)) {
      // Dedupe: markTts/AiKeyInvalid returns true only on the first flip
      // (updateMany WHERE isValid=true), so only the first worker sends the notification.
      let didInvalidateKey = false;

      if (TTS_QUEUES.includes(queueName) && episode.ttsProvider) {
        didInvalidateKey = await markTtsKeyInvalid(
          episode.userId,
          episode.ttsProvider as TtsProviderId
        );
        failureReason = userMessage(errorKind, episode.ttsProvider);
        await prisma.episode.update({
          where: { id: episodeId },
          data: { ttsProvider: null, ttsModel: null },
        });
      } else if (AI_QUEUES.includes(queueName)) {
        const aiKey = await prisma.userAiKey.findFirst({
          where: { userId: episode.userId, isValid: true },
        });
        if (aiKey) {
          didInvalidateKey = await markAiKeyInvalid(episode.userId, aiKey.provider as AiProviderId);
          failureReason = userMessage(errorKind, aiKey.provider);
        }
      }

      if (didInvalidateKey && notifQueue) {
        await notifQueue.add('send_notification', {
          userId: episode.userId,
          type: 'KEY_INVALID',
          title: 'API Key Invalid',
          message: failureReason,
          data: { episodeId },
        });
      }
    }

    const errorId = `err_${Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`;

    const didTransition = await markEpisodeFailed(episodeId, {
      failureReason,
      technicalError: failedReason || undefined,
      errorId,
    });

    if (!didTransition) {
      logger.info('Episode already failed, skipping duplicate notifications', { episodeId });
      return;
    }

    if (notifQueue) {
      await notifQueue.add('send_notification', {
        userId: episode.userId,
        type: 'EPISODE_FAILED',
        title: 'Generation Failed',
        message: `${failureReason} (ref: ${errorId})`,
        data: { episodeId },
      });
    }

    const episodeLabel = episode.title || episodeId;
    const adminUsers = await prisma.user.findMany({
      where: { role: 'ADMIN', id: { not: episode.userId } },
      select: { id: true },
    });
    const adminMessage = `[${queueName}] ${episodeLabel} (by ${ownerLabel}) — ${errorKind}`;
    for (const admin of adminUsers) {
      if (notifQueue) {
        notifQueue
          .add('send_notification', {
            userId: admin.id,
            type: 'PIPELINE_FAILURE',
            title: 'Pipeline Failure',
            message: adminMessage,
            data: { episodeId },
          })
          .catch((err: unknown) => {
            logger.warn('Failed to queue admin pipeline-failure notification', {
              adminId: admin.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
      }
    }

    logger.info('Marked episode as FAILED after generation failure', {
      userId: episode.userId,
      episodeId,
      errorKind,
      failureReason,
    });
  } catch (err) {
    logger.error('Failed to process failure handler', {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
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

/**
 * Add job to queue
 */
export async function addJob<T>(
  queue: Queue,
  jobType: JobType,
  payload: T,
  options?: { priority?: number; delay?: number; attempts?: number; jobId?: string }
): Promise<Job<T>> {
  // Only pass defined values — undefined overrides BullMQ's defaultJobOptions via Object.assign
  const opts: Record<string, unknown> = {};
  if (options?.priority != null) opts.priority = options.priority;
  if (options?.delay != null) opts.delay = options.delay;
  if (options?.attempts != null) opts.attempts = options.attempts;
  if (options?.jobId != null) opts.jobId = options.jobId;

  const job = await queue.add(jobType, payload, opts);

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
  const queueDefinition = getQueueDefinition(queueName);
  const connection = createRedisConnection(`worker:${queueName}`) as unknown as ConnectionOptions;

  const worker = new Worker<T>(queueName, processor, {
    connection,
    concurrency: config?.concurrency || 3,
    lockDuration: config?.lockDuration || 30000,
  });

  worker.on('ready', () => logger.info(`Worker ready for ${queueName}`));
  worker.on('error', (err) => logWorkerError(queueName, err));
  worker.on('completed', (job) => {
    if (!queueDefinition.skipEvents) {
      logJobCompleted(queueName, job as Job<unknown>);
    }
  });
  worker.on('failed', (job, err) => {
    logWorkerJobFailure(queueName, job as Job<unknown> | undefined, err);
    if (!queueDefinition.skipEvents) {
      void handleWorkerFailure(queueName, job as Job<unknown> | undefined, err.message);
    }
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
export const scriptGenerationQueue = createQueueReference('script-generation');
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

export interface VerifyClassReferencesPayload {
  episodeId: string;
}
export const waveformGenerationQueue = createQueueReference('waveform-generation');
export const ttsProviderMonitorQueue = createQueueReference('tts-provider-monitor');
export const speakingGradingQueue = createQueueReference('speaking-grading');
export const worksheetPdfQueue = createQueueReference('worksheet-pdf');
export const verifyClassReferencesQueue = createQueueReference('verify-class-references');

/** All queue names — single source of truth for admin and health endpoints */
export const ALL_QUEUE_NAMES = Object.freeze(Object.keys(QUEUE_DEFINITIONS));
