/** Shared queue stats shape (matches GET /api/admin/queues response) */
export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export type PipelineStage =
  | 'Content Pipeline'
  | 'Audio Pipeline'
  | 'Interactions'
  | 'Social'
  | 'Analytics'
  | 'Platform Ops'
  | 'Voice Features'
  | 'Video Pipeline';

interface QueueMeta {
  description: string;
  stage: PipelineStage;
}

export const PIPELINE_STAGE_ORDER: PipelineStage[] = [
  'Content Pipeline',
  'Audio Pipeline',
  'Interactions',
  'Social',
  'Analytics',
  'Platform Ops',
  'Voice Features',
  'Video Pipeline',
];

export const QUEUE_METADATA: Record<string, QueueMeta> = {
  'content-extraction': {
    description: 'Extracts text from URLs, PDFs, and uploaded files',
    stage: 'Content Pipeline',
  },
  'script-generation': {
    description: 'Generates 2-voice conversational podcast scripts via LLM',
    stage: 'Content Pipeline',
  },
  'script-verification': {
    description: 'Fact-checks script claims and enforces duration limits',
    stage: 'Content Pipeline',
  },
  'reference-validation': {
    description: 'Validates source URLs and citation quality',
    stage: 'Content Pipeline',
  },
  'audio-generation': {
    description: 'Converts script segments to audio via TTS providers',
    stage: 'Audio Pipeline',
  },
  'audio-stitching': {
    description: 'Concatenates audio segments with crossfades and SFX',
    stage: 'Audio Pipeline',
  },
  'segment-regeneration': {
    description: 'Re-generates individual audio segments after edits',
    stage: 'Audio Pipeline',
  },
  'audio-import': {
    description: 'Imports and transcribes uploaded audio files',
    stage: 'Audio Pipeline',
  },
  'interactions': {
    description: 'Processes mid-playback Q&A interruptions',
    stage: 'Interactions',
  },
  'pdf-generation': {
    description: 'Generates PDF transcripts with references',
    stage: 'Interactions',
  },
  'twitter-mentions': {
    description: 'Polls Twitter for @SottoFM mentions',
    stage: 'Social',
  },
  'twitter-reply': {
    description: 'Posts tweet replies with podcast links',
    stage: 'Social',
  },
  'twitter-auto-tweet': {
    description: 'Auto-tweets trending podcasts above threshold',
    stage: 'Social',
  },
  'twitter-trend-poll': {
    description: 'Polls Twitter trending topics for inspiration',
    stage: 'Social',
  },
  'telegram-bot': {
    description: 'Processes incoming Telegram bot messages',
    stage: 'Social',
  },
  'telegram-reply': {
    description: 'Sends Telegram bot replies and notifications',
    stage: 'Social',
  },
  'admin-thread-to-podcast': {
    description: 'Converts admin-selected Twitter threads to podcasts',
    stage: 'Social',
  },
  'event-ingestion': {
    description: 'Ingests behavioral analytics events in batches',
    stage: 'Analytics',
  },
  'feature-computation': {
    description: 'Computes ML features for recommendations',
    stage: 'Analytics',
  },
  'data-export': {
    description: 'Exports analytics data for reporting',
    stage: 'Analytics',
  },
  'notifications': {
    description: 'Sends push notifications to user devices',
    stage: 'Platform Ops',
  },
  'key-validation': {
    description: 'Validates BYOK API keys for TTS and AI providers',
    stage: 'Platform Ops',
  },
  'content-moderation': {
    description: 'Moderates user-generated content via OpenAI',
    stage: 'Platform Ops',
  },
  'email-digest': {
    description: 'Sends weekly email digests to subscribers',
    stage: 'Platform Ops',
  },
  'announcements': {
    description: 'Delivers platform announcements to users',
    stage: 'Platform Ops',
  },
  'draft-cleanup': {
    description: 'Cleans up stale draft podcasts',
    stage: 'Platform Ops',
  },
  'voice-verification': {
    description: 'Verifies voice clone ownership and quality',
    stage: 'Voice Features',
  },
  'voice-track-audio': {
    description: 'Generates audio for voice marketplace tracks',
    stage: 'Voice Features',
  },
  'voice-track-stitching': {
    description: 'Stitches voice track audio segments together',
    stage: 'Voice Features',
  },
  'r2-usage': {
    description: 'Collects R2 storage usage and operations data from Cloudflare API',
    stage: 'Platform Ops',
  },
  'pricing-fetch': {
    description: 'Fetches AI model pricing from provider pages and updates snapshots',
    stage: 'Platform Ops',
  },
  'visual-classification': {
    description: 'Classifies podcast segments into visual types via Claude',
    stage: 'Video Pipeline',
  },
  'visual-generation': {
    description: 'Generates AI illustrations and fetches stock footage per segment',
    stage: 'Video Pipeline',
  },
  'video-composition': {
    description: 'Renders final MP4 video via Remotion sidecar',
    stage: 'Video Pipeline',
  },
};
