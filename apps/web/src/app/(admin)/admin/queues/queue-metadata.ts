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
  | 'Analytics'
  | 'Platform Ops'
  | 'Voice Features'
  | 'Video Pipeline'
  | 'Music Pipeline';

interface QueueMeta {
  description: string;
  stage: PipelineStage;
}

export const PIPELINE_STAGE_ORDER: PipelineStage[] = [
  'Content Pipeline',
  'Audio Pipeline',
  'Interactions',
  'Analytics',
  'Platform Ops',
  'Voice Features',
  'Video Pipeline',
  'Music Pipeline',
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
  'speaking-grading': {
    description: 'Transcribes learner speaking recordings and scores pronunciation',
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
  'draft-cleanup': {
    description: 'Cleans up stale draft podcasts',
    stage: 'Platform Ops',
  },
  'voice-verification': {
    description: 'Verifies voice clone ownership and quality',
    stage: 'Voice Features',
  },
  'voice-track-audio': {
    description: 'Generates audio for paid voice-sharing tracks',
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
  'avatar-generation': {
    description: 'Generates lip-synced avatar overlays via HeyGen',
    stage: 'Video Pipeline',
  },
  'transition-generation': {
    description: 'Generates AI video transitions between segment visuals',
    stage: 'Video Pipeline',
  },
  'place-enrichment': {
    description: 'Resolves place names to coordinates via gazetteers for map visuals',
    stage: 'Video Pipeline',
  },
  'demo-script': {
    description: 'Generates demo video scripts from project features',
    stage: 'Video Pipeline',
  },
  'demo-recording': {
    description: 'Records browser sessions via Playwright for demo scenes',
    stage: 'Video Pipeline',
  },
  'demo-voiceover': {
    description: 'Generates TTS voiceover narration for demo scenes',
    stage: 'Video Pipeline',
  },
  'demo-visual': {
    description: 'Generates visual assets for demo scenes',
    stage: 'Video Pipeline',
  },
  'demo-transition': {
    description: 'Creates transition clips between demo scenes',
    stage: 'Video Pipeline',
  },
  'demo-composition': {
    description: 'Composes final demo video from all scene assets',
    stage: 'Video Pipeline',
  },
  'demo-scene-composition': {
    description: 'Composes individual demo scenes from visual, voiceover, and recording assets',
    stage: 'Video Pipeline',
  },
  'music-generation': {
    description: 'Generates AI background music for podcasts via Suno or ElevenLabs',
    stage: 'Music Pipeline',
  },
  'lip-sync-test': {
    description: 'Tests lip-sync models with a short audio clip and avatar image via fal.ai',
    stage: 'Video Pipeline',
  },
  'waveform-generation': {
    description: 'Generates waveform peaks JSON and spectrogram PNG from podcast audio',
    stage: 'Audio Pipeline',
  },
  'pipeline-classification': {
    description: 'Classifies segment visuals via LLM and builds pipeline JSON for the video editor',
    stage: 'Video Pipeline',
  },
  'tts-provider-monitor': {
    description: 'Daily monitor: fetches models/voices from TTS APIs, diffs against snapshot, creates GitHub issues for changes',
    stage: 'Platform Ops',
  },
  'worksheet-pdf': {
    description: 'Renders class worksheet to a print-optimized PDF via Playwright and uploads to storage',
    stage: 'Content Pipeline',
  },
};
