/** Shared queue stats shape (matches GET /api/v1/admin/queues response) */
export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export type PipelineStage = 'Content Pipeline' | 'Audio Pipeline' | 'Interactions' | 'Platform Ops';

interface QueueMeta {
  description: string;
  stage: PipelineStage;
}

export const PIPELINE_STAGE_ORDER: PipelineStage[] = [
  'Content Pipeline',
  'Audio Pipeline',
  'Interactions',
  'Platform Ops',
];

export const QUEUE_METADATA: Record<string, QueueMeta> = {
  'material-analysis': {
    description:
      'Discovers source focuses from every retained text chunk with saved response receipts',
    stage: 'Content Pipeline',
  },
  'placement-generation': {
    description: 'Prepares private placement question sessions bound to exact source analyses',
    stage: 'Content Pipeline',
  },
  'material-optimization': {
    description: 'Verifies complete PDF content before publishing optional lossless compression',
    stage: 'Content Pipeline',
  },
  'material-extraction': {
    description: 'Extracts complete page text and records visual coverage gaps',
    stage: 'Content Pipeline',
  },
  'material-finalization': {
    description: 'Verifies uploaded parts and publishes the complete original document',
    stage: 'Content Pipeline',
  },
  'vocabulary-index': {
    description: 'Indexes complete course materials with reviewed vocabulary coverage',
    stage: 'Content Pipeline',
  },
  'vocabulary-audio': {
    description: 'Prepares reusable local pronunciation for dictionary study',
    stage: 'Audio Pipeline',
  },
  'class-preparation': {
    description: 'Prepares learner classes from durable scheduled or immediate requests',
    stage: 'Content Pipeline',
  },
  'practice-preparation': {
    description: 'Prepares saved learner practice from durable requests',
    stage: 'Content Pipeline',
  },
  'content-extraction': {
    description: 'Extracts text from URLs, PDFs, and uploaded files',
    stage: 'Content Pipeline',
  },
  'deep-research': {
    description: 'Builds a sourced research dossier for an episode',
    stage: 'Content Pipeline',
  },
  'creative-planning': {
    description: 'Creates the episode format, structure, and creative direction',
    stage: 'Content Pipeline',
  },
  'script-writing': {
    description: 'Writes the episode script from the approved research and plan',
    stage: 'Content Pipeline',
  },
  'compile-script': {
    description: 'Compiles the completed script into audio-ready segments',
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
  interactions: {
    description: 'Processes mid-playback Q&A interruptions',
    stage: 'Interactions',
  },
  'pdf-generation': {
    description: 'Generates PDF transcripts with references',
    stage: 'Interactions',
  },
  notifications: {
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
  'waveform-generation': {
    description: 'Generates waveform peaks JSON and spectrogram PNG from episode audio',
    stage: 'Audio Pipeline',
  },
  'episode-status': {
    description: 'Refreshes episode caches and notifies connected players to fetch current state',
    stage: 'Audio Pipeline',
  },
  'worksheet-pdf': {
    description:
      'Renders class worksheet to a print-optimized PDF via Playwright and uploads to storage',
    stage: 'Content Pipeline',
  },
  'pencil-homework': {
    description: 'Interprets exercise images and learner ink for review before class submission',
    stage: 'Content Pipeline',
  },
};
