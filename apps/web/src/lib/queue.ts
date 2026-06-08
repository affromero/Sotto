import { ConnectionOptions, Queue, Worker, Job } from 'bullmq';
import { createRedisConnection, getSharedQueueRedisClient, cache } from './redis';
import { logger } from './logger';
import { prismaUnfiltered as prisma } from './prisma';
import { markPodcastFailed } from './pipeline-resume';
import { classifyError, isKeyInvalidationError, userMessage } from './byok-errors';
import { markTtsKeyInvalid, markAiKeyInvalid } from './byok';
import type { AiProviderId } from './providers/ai-registry';
import type { TtsProviderId } from './providers/tts-registry';
import type { SttProviderId } from '@sotto/shared';

/** Cached admin user lookup — avoids hitting DB on every worker failure. */
async function getCachedAdminUsers(): Promise<Array<{ id: string }>> {
  const cacheKey = 'admin_users';
  const cached = await cache.get<Array<{ id: string }>>(cacheKey);
  if (cached) return cached;
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true },
  });
  await cache.set(cacheKey, admins, 3600);
  return admins;
}

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
  VERIFY_SCRIPT = 'verify_script',
  VALIDATE_REFERENCES = 'validate_references',
  GENERATE_AUDIO = 'generate_audio',
  STITCH_AUDIO = 'stitch_audio',
  PROCESS_INTERACTION = 'process_interaction',
  REGENERATE_SEGMENT = 'regenerate_segment',
  SEND_NOTIFICATION = 'send_notification',
  GENERATE_PDF = 'generate_pdf',
  IMPORT_AUDIO = 'import_audio',
  INGEST_EVENTS = 'ingest_events',
  COMPUTE_FEATURES = 'compute_features',
  EXPORT_DATA = 'export_data',
  VALIDATE_KEYS = 'validate_keys',
MODERATE_CONTENT = 'moderate_content',
  VERIFY_VOICE = 'verify_voice',
  GENERATE_VOICE_TRACK_AUDIO = 'generate_voice_track_audio',
  STITCH_VOICE_TRACK = 'stitch_voice_track',
  CLEANUP_DRAFTS = 'cleanup_drafts',
  COLLECT_R2_USAGE = 'collect_r2_usage',
  FETCH_PRICING = 'fetch_pricing',
  CLASSIFY_VISUALS = 'classify_visuals',
  GENERATE_VISUAL = 'generate_visual',
  GENERATE_TRANSITION = 'generate_transition',
  COMPOSE_VIDEO = 'compose_video',
  GENERATE_AVATAR = 'generate_avatar',
  PLACE_ENRICHMENT = 'place_enrichment',
  GENERATE_DEMO_SCRIPT = 'generate_demo_script',
  GENERATE_DEMO_RECORDING = 'generate_demo_recording',
  GENERATE_DEMO_VOICEOVER = 'generate_demo_voiceover',
  GENERATE_DEMO_VISUAL = 'generate_demo_visual',
  GENERATE_DEMO_TRANSITION = 'generate_demo_transition',
  COMPOSE_DEMO = 'compose_demo',
  COMPOSE_DEMO_SCENE = 'compose_demo_scene',
  GENERATE_MUSIC = 'generate_music',
  LIP_SYNC_TEST = 'lip_sync_test',
  GENERATE_WAVEFORM = 'generate_waveform',
  GENERATE_QUIZ = 'generate_quiz',
  CLASSIFY_PIPELINE = 'classify_pipeline',
  MONITOR_TTS_PROVIDERS = 'monitor_tts_providers',
  RENDER_SEGMENT_PREVIEW = 'render_segment_preview',
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
  referenceRetryAttempt?: number; // 0-based, undefined = first pass
  previousVerifiedCount?: number; // for early termination (going backward = stop)
  previouslyVerifiedRefIds?: string[]; // skip re-verification on retry
}

export interface DeepResearchPayload {
  podcastId: string;
  userId: string;
  discoveryId: string;
  useAdminCredits?: boolean;
}

export interface CreativePlanningPayload {
  podcastId: string;
  userId: string;
  discoveryId: string;
  dossierId: string;
  useAdminCredits?: boolean;
}

export interface WriteScriptPayload {
  podcastId: string;
  userId: string;
  discoveryId: string;
  dossierId: string;
  outlineId: string;
  useAdminCredits?: boolean;
  sourceUrls?: string[];
}

export interface CompileScriptPayload {
  podcastId: string;
  userId: string;
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

export interface ImportAudioPayload {
  podcastId: string;
  userId: string;
  audioKey: string;
  transcriptText?: string;
  isHumanContent: boolean;
  generateMetadata?: boolean;
  sttProvider?: 'openai' | 'elevenlabs' | 'together' | 'deepgram' | 'assemblyai';
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

export interface GenerateDemoScriptPayload {
  projectId: string;
  durationTarget?: number;
}

export interface GenerateDemoRecordingPayload {
  projectId: string;
  sceneId: string;
}

export interface GenerateDemoVoiceoverPayload {
  projectId: string;
  sceneId: string;
}

export interface GenerateDemoVisualPayload {
  projectId: string;
  sceneId: string;
}

export interface GenerateDemoTransitionPayload {
  projectId: string;
  sceneId: string;
}

export interface ComposeDemoPayload {
  projectId: string;
}

export interface ComposeDemoScenePayload {
  projectId: string;
  sceneId: string;
}

export interface ModerateContentPayload {
  targetType: 'podcast';
  targetId: string;
  content: string;
  userId?: string;
}

export interface CollectR2UsagePayload {}

export interface FetchPricingPayload {}

export interface MonitorTtsProvidersPayload {}

export interface ClassifyVisualsPayload {
  podcastId: string;
  videoGenerationId: string;
  userId: string;
  voiceTrackId?: string;
  zeroCostVideo?: boolean;
}

export interface GenerateVisualPayload {
  podcastId: string;
  videoGenerationId: string;
  segmentVisualId: string;
  visualType: string;
  prompt: string;
  metadata: Record<string, unknown>;
  voiceTrackId?: string;
}

export interface ComposeVideoPayload {
  podcastId: string;
  videoGenerationId: string;
  voiceTrackId?: string;
}

export interface RenderSegmentPreviewPayload {
  podcastId: string;
  videoGenerationId: string;
  segmentVisualId: string;
  quality: 'preview' | 'full';
}

export interface PlaceEnrichmentPayload {
  segmentVisualId: string;
  podcastId: string;
  videoGenerationId: string;
  places: Array<{ name: string; yearHint?: number }>;
}

export interface GenerateAvatarPayload {
  podcastId: string;
  videoGenerationId: string;
  avatarOverlayId: string;
  speaker: string;
  avatarId: string;
  avatarProvider?: 'heygen' | 'runway' | 'fal' | 'replicate';
  avatarImageUrl?: string;
  avatarModelId?: string;
  isPreset?: boolean;
  voiceTrackId?: string;
}

export interface GenerateTransitionPayload {
  podcastId: string;
  videoGenerationId: string;
  transitionId: string;
  userId: string;
}

export interface GenerateVoiceTrackAudioPayload {
  podcastId: string;
  voiceTrackId: string;
  voiceTrackSegmentId: string;
  segmentId: string;
  speaker: string;
  text: string;
  previousText?: string;
  nextText?: string;
  direction?: string;
}

export interface StitchVoiceTrackPayload {
  podcastId: string;
  voiceTrackId: string;
  voiceTrackSegmentIds: string[];
}

export interface GenerateMusicPayload {
  podcastId: string;
  musicGenerationId: string;
  userId: string;
}

export interface GenerateWaveformPayload {
  podcastId: string;
  userId: string;
}

export interface GenerateQuizPayload {
  podcastId: string;
}

export interface ClassifyPipelinePayload {
  classificationId: string;
  podcastId: string;
  userId: string;
  aiProvider: string;
  aiModel: string;
  apiKeyOverride?: string;
  tier: 'FREE' | 'PRO';
  voiceTrackId?: string;
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
  'script-verification': { attempts: 2 },
  'reference-validation': { attempts: 2 },
  'audio-generation': { attempts: 3 },
  'audio-stitching': { attempts: 2 },
  interactions: { attempts: 3 },
  'segment-regeneration': { attempts: 2 },
  notifications: { attempts: 5, skipEvents: true },
  'pdf-generation': { attempts: 2, skipEvents: true },
  'event-ingestion': { attempts: 2, removeOnComplete: { age: 3600, count: 500 }, skipEvents: true },
  'audio-import': { attempts: 2 },
  'feature-computation': { attempts: 2, skipEvents: true },
  'data-export': { attempts: 2, skipEvents: true },
  'key-validation': { attempts: 1, skipEvents: true },
  'content-moderation': { attempts: 2, skipEvents: true },
  'voice-verification': { attempts: 2, skipEvents: true },
  'voice-track-audio': { attempts: 3 },
  'voice-track-stitching': { attempts: 2 },
  'draft-cleanup': { attempts: 1, skipEvents: true },
  'r2-usage': { attempts: 2, skipEvents: true },
  'pricing-fetch': { attempts: 2, skipEvents: true },
  'visual-classification': { attempts: 2 },
  'visual-generation': { attempts: 3 },
  'transition-generation': { attempts: 3 },
  'video-composition': { attempts: 2 },
  'avatar-generation': { attempts: 2 },
  'place-enrichment': { attempts: 2 },
  'demo-script': { attempts: 2 },
  'demo-recording': { attempts: 2 },
  'demo-voiceover': { attempts: 2 },
  'demo-visual': { attempts: 2 },
  'demo-transition': { attempts: 2 },
  'demo-composition': { attempts: 2 },
  'demo-scene-composition': { attempts: 2 },
  'music-generation': { attempts: 3 },
  'lip-sync-test': { attempts: 1 },
  'waveform-generation': { attempts: 2, skipEvents: true },
  'quiz-generation': { attempts: 2, skipEvents: true },
  'pipeline-classification': { attempts: 2, skipEvents: true },
  'tts-provider-monitor': { attempts: 2, skipEvents: true },
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
    const podcastId = (job?.data as Record<string, unknown> | undefined)?.podcastId as
      | string
      | undefined;
    if (!podcastId) {
      return;
    }

    await prisma.pipelineEvent
      .create({
        data: {
          podcastId,
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

    const VOICE_TRACK_QUEUES = ['voice-track-audio', 'voice-track-stitching'];
    if (VOICE_TRACK_QUEUES.includes(queueName)) {
      const voiceTrackId = (job?.data as Record<string, unknown> | undefined)?.voiceTrackId as
        | string
        | undefined;
      if (!voiceTrackId) {
        return;
      }

      const errorKind = classifyError(failedReason || '');
      const failureReason = userMessage(errorKind, 'the provider');

      const voiceTrack = await prisma.voiceTrack.findUnique({
        where: { id: voiceTrackId },
        select: { podcastId: true, name: true },
      });
      if (!voiceTrack) {
        return;
      }

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

      const notifQueue = createQueue('notifications');
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
        status: true,
        userId: true,
        title: true,
        ttsProvider: true,
        source: true,
        user: { select: { name: true, email: true } },
      },
    });
    if (!podcast) {
      return;
    }

    const errorKind = classifyError(failedReason || '');
    const notifQueue = createQueue('notifications');
    const ownerLabel = podcast.user?.name || podcast.user?.email || podcast.userId;

    const TTS_QUEUES = ['audio-generation', 'segment-regeneration', 'voice-track-audio'];
    const AI_QUEUES = ['script-generation', 'script-verification', 'reference-validation'];

    const VIDEO_QUEUES = [
      'visual-classification',
      'visual-generation',
      'transition-generation',
      'video-composition',
      'place-enrichment',
    ];
    if (VIDEO_QUEUES.includes(queueName)) {
      const videoGenerationId = (job?.data as Record<string, unknown> | undefined)
        ?.videoGenerationId as string | undefined;
      if (!videoGenerationId) {
        return;
      }

      const maxAttempts = job?.opts?.attempts ?? QUEUE_DEFINITIONS[queueName]?.attempts ?? 3;
      const isTerminal = !job || (job.attemptsMade != null && job.attemptsMade >= maxAttempts);
      if (!isTerminal) {
        return;
      }

      // Don't update VideoGeneration or send notifications here.
      // The worker's checkAllReady() handles aggregate state + notifications
      // once ALL visuals are done — avoids duplicate notifications per failed job.
      // PipelineEvent (logged above) still captures every individual failure.
      return;
    }

    const AVATAR_QUEUES = ['avatar-generation'];
    if (AVATAR_QUEUES.includes(queueName)) {
      const maxAttempts = job?.opts?.attempts ?? QUEUE_DEFINITIONS[queueName]?.attempts ?? 3;
      const isTerminal = !job || (job.attemptsMade != null && job.attemptsMade >= maxAttempts);
      if (!isTerminal) {
        return;
      }

      if (notifQueue) {
        await notifQueue.add('send_notification', {
          userId: podcast.userId,
          type: 'AVATAR_FAILED',
          title: 'Avatar Generation Failed',
          message: `Avatar generation failed: ${failedReason || 'Unknown error'}`,
          data: { podcastId },
        });
      }

      const podcastLabel = podcast.title || podcastId;
      const allAdmins = await getCachedAdminUsers();
      const adminUsers = allAdmins.filter((a) => a.id !== podcast.userId);
      for (const admin of adminUsers) {
        if (notifQueue) {
          notifQueue
            .add('send_notification', {
              userId: admin.id,
              type: 'PIPELINE_FAILURE',
              title: 'Avatar Pipeline Failure',
              message: `[avatar-generation] ${podcastLabel} (by ${ownerLabel}) — ${errorKind}`,
              data: { podcastId },
            })
            .catch(() => {});
        }
      }
      return;
    }

    const MUSIC_QUEUES = ['music-generation'];
    if (MUSIC_QUEUES.includes(queueName)) {
      const musicGenerationId = (job?.data as Record<string, unknown> | undefined)
        ?.musicGenerationId as string | undefined;
      if (!musicGenerationId) {
        return;
      }

      const maxAttempts = job?.opts?.attempts ?? QUEUE_DEFINITIONS[queueName]?.attempts ?? 3;
      const isTerminal = !job || (job.attemptsMade != null && job.attemptsMade >= maxAttempts);
      if (!isTerminal) {
        return;
      }

      const descriptive = `[${queueName}] ${failedReason || 'Unknown error'}`;
      await prisma.musicGeneration
        .update({
          where: { id: musicGenerationId },
          data: { status: 'FAILED', failureReason: descriptive },
        })
        .catch((err: unknown) => {
          logger.error('Failed to mark MusicGeneration FAILED', {
            musicGenerationId,
            error: err instanceof Error ? err.message : String(err),
          });
        });

      if (notifQueue) {
        await notifQueue.add('send_notification', {
          userId: podcast.userId,
          type: 'MUSIC_FAILED',
          title: 'Music Generation Failed',
          message: `Background music generation failed: ${failedReason || 'Unknown error'}`,
          data: { podcastId },
        });
      }
      return;
    }

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

    if (
      podcast.status === 'READY' ||
      podcast.status === 'FAILED' ||
      podcast.status === 'SCRIPT_READY' ||
      podcast.status === 'DRAFT'
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
      'script-verification': 'Script verification',
      'reference-validation': 'Reference validation',
      'audio-generation': 'Audio generation',
      'audio-stitching': 'Audio stitching',
      'segment-regeneration': 'Segment regeneration',
      'audio-import': 'Audio import',
      'voice-track-audio': 'Voice track generation',
      'voice-track-stitching': 'Voice track stitching',
    };
    const stageLabel = STAGE_LABELS[queueName] || 'Generation';
    let failureReason = userMessage(errorKind, 'the provider', stageLabel);

    if (isKeyInvalidationError(errorKind)) {
      // Dedupe: markTts/AiKeyInvalid returns true only on the first flip
      // (updateMany WHERE isValid=true), so only the first worker sends the notification.
      let didInvalidateKey = false;

      if (TTS_QUEUES.includes(queueName) && podcast.ttsProvider) {
        didInvalidateKey = await markTtsKeyInvalid(
          podcast.userId,
          podcast.ttsProvider as TtsProviderId
        );
        failureReason = userMessage(errorKind, podcast.ttsProvider);
        await prisma.podcast.update({
          where: { id: podcastId },
          data: { ttsProvider: null, ttsModel: null },
        });
      } else if (AI_QUEUES.includes(queueName)) {
        const aiKey = await prisma.userAiKey.findFirst({
          where: { userId: podcast.userId, isValid: true },
        });
        if (aiKey) {
          didInvalidateKey = await markAiKeyInvalid(podcast.userId, aiKey.provider as AiProviderId);
          failureReason = userMessage(errorKind, aiKey.provider);
        }
      } else if (queueName === 'audio-import') {
        const sttProvider = (job?.data as Record<string, unknown> | undefined)?.sttProvider as
          | SttProviderId
          | undefined;
        if (sttProvider === 'elevenlabs') {
          didInvalidateKey = await markTtsKeyInvalid(podcast.userId, 'elevenlabs');
          failureReason = userMessage(errorKind, 'ElevenLabs');
        } else if (sttProvider) {
          didInvalidateKey = await markAiKeyInvalid(podcast.userId, sttProvider as AiProviderId);
          failureReason = userMessage(errorKind, sttProvider);
        }
      }

      if (didInvalidateKey && notifQueue) {
        await notifQueue.add('send_notification', {
          userId: podcast.userId,
          type: 'KEY_INVALID',
          title: 'API Key Invalid',
          message: failureReason,
          data: { podcastId },
        });
      }
    }

    const errorId = `err_${Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`;

    const didTransition = await markPodcastFailed(podcastId, {
      failureReason,
      technicalError: failedReason || undefined,
      errorId,
    });

    if (!didTransition) {
      logger.info('Podcast already failed, skipping duplicate notifications', { podcastId });
      return;
    }

    if (notifQueue) {
      await notifQueue.add('send_notification', {
        userId: podcast.userId,
        type: 'PODCAST_FAILED',
        title: 'Generation Failed',
        message: `${failureReason} (ref: ${errorId})`,
        data: { podcastId },
      });
    }

    const podcastLabel = podcast.title || podcastId;
    const adminUsers = await prisma.user.findMany({
      where: { role: 'ADMIN', id: { not: podcast.userId } },
      select: { id: true },
    });
    const adminMessage = `[${queueName}] ${podcastLabel} (by ${ownerLabel}) — ${errorKind}`;
    for (const admin of adminUsers) {
      if (notifQueue) {
        notifQueue
          .add('send_notification', {
            userId: admin.id,
            type: 'PIPELINE_FAILURE',
            title: 'Pipeline Failure',
            message: adminMessage,
            data: { podcastId },
          })
          .catch((err: unknown) => {
            logger.warn('Failed to queue admin pipeline-failure notification', {
              adminId: admin.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
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
export const referenceValidationQueue = createQueueReference('reference-validation');
export const pdfGenerationQueue = createQueueReference('pdf-generation');
export const scriptVerificationQueue = createQueueReference('script-verification');
export const eventIngestionQueue = createQueueReference('event-ingestion');
export const audioImportQueue = createQueueReference('audio-import');
export const featureComputationQueue = createQueueReference('feature-computation');
export const dataExportQueue = createQueueReference('data-export');
export const keyValidationQueue = createQueueReference('key-validation');
export const contentModerationQueue = createQueueReference('content-moderation');
export const voiceVerificationQueue = createQueueReference('voice-verification');
export const voiceTrackAudioQueue = createQueueReference('voice-track-audio');
export const voiceTrackStitchingQueue = createQueueReference('voice-track-stitching');
export const draftCleanupQueue = createQueueReference('draft-cleanup');
export const r2UsageQueue = createQueueReference('r2-usage');
export const pricingFetchQueue = createQueueReference('pricing-fetch');
export const visualClassificationQueue = createQueueReference('visual-classification');
export const visualGenerationQueue = createQueueReference('visual-generation');
export const transitionGenerationQueue = createQueueReference('transition-generation');
export const videoCompositionQueue = createQueueReference('video-composition');
export const avatarGenerationQueue = createQueueReference('avatar-generation');
export interface LipSyncTestPayload {
  userId: string;
  audioUrl: string;
  avatarImageUrl: string;
  avatarModelId: string;
}
export const lipSyncTestQueue = createQueueReference('lip-sync-test');
export const placeEnrichmentQueue = createQueueReference('place-enrichment');
export const demoScriptQueue = createQueueReference('demo-script');
export const demoRecordingQueue = createQueueReference('demo-recording');
export const demoVoiceoverQueue = createQueueReference('demo-voiceover');
export const demoVisualQueue = createQueueReference('demo-visual');
export const demoTransitionQueue = createQueueReference('demo-transition');
export const demoCompositionQueue = createQueueReference('demo-composition');
export const demoSceneCompositionQueue = createQueueReference('demo-scene-composition');
export const musicGenerationQueue = createQueueReference('music-generation');
export const waveformGenerationQueue = createQueueReference('waveform-generation');
export const quizGenerationQueue = createQueueReference('quiz-generation');
export const pipelineClassificationQueue = createQueueReference('pipeline-classification');
export const ttsProviderMonitorQueue = createQueueReference('tts-provider-monitor');
export const segmentPreviewQueue = createQueueReference('segment-preview');

/** All queue names — single source of truth for admin and health endpoints */
export const ALL_QUEUE_NAMES = Object.freeze(Object.keys(QUEUE_DEFINITIONS));
