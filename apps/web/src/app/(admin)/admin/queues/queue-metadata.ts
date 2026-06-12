/** Shared queue stats shape (matches GET /api/v1/admin/queues response) */
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
  | 'Platform Ops'
  | 'Video Pipeline';

interface QueueMeta {
  description: string;
  stage: PipelineStage;
}

export const PIPELINE_STAGE_ORDER: PipelineStage[] = [
  'Content Pipeline',
  'Audio Pipeline',
  'Interactions',
  'Platform Ops',
  'Video Pipeline',
];

export const QUEUE_METADATA: Record<string, QueueMeta> = {
  'content-extraction': {
    description: 'Extracts text from URLs, PDFs, and uploaded files',
    stage: 'Content Pipeline',
  },
  'script-generation': {
    description: 'Generates 2-voice conversational episode scripts via LLM',
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
  'verify-class-references': {
    description: 'Verify-only reference check for sourced classes (writes verdicts, never creates segments)',
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
  'interactions': {
    description: 'Processes mid-playback Q&A interruptions',
    stage: 'Interactions',
  },
  'pdf-generation': {
    description: 'Generates PDF transcripts with references',
    stage: 'Interactions',
  },
  'notifications': {
    description: 'Sends push notifications to user devices',
    stage: 'Platform Ops',
  },
  'key-validation': {
    description: 'Validates BYOK API keys for TTS and AI providers',
    stage: 'Platform Ops',
  },
  'pricing-fetch': {
    description: 'Fetches AI model pricing from provider pages and updates snapshots',
    stage: 'Platform Ops',
  },
  'visual-classification': {
    description: 'Classifies episode segments into visual types via Claude',
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
  'lip-sync-test': {
    description: 'Tests lip-sync models with a short audio clip and avatar image via fal.ai',
    stage: 'Video Pipeline',
  },
  'waveform-generation': {
    description: 'Generates waveform peaks JSON and spectrogram PNG from episode audio',
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
