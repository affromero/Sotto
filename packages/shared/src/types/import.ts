export interface ImportPodcastRequest {
  title: string;
  topic: string;
  isHumanContent: boolean;
  sourcePlatform?: string;
}

export type SourcePlatformValue = 'notebooklm' | 'spotify' | 'apple_podcasts' | 'youtube' | 'other';

export interface SourcePlatformInfo {
  value: SourcePlatformValue;
  label: string;
  isAiGenerated: boolean;
}

export const SOURCE_PLATFORMS: SourcePlatformInfo[] = [
  { value: 'notebooklm', label: 'NotebookLM', isAiGenerated: true },
  { value: 'spotify', label: 'Spotify', isAiGenerated: false },
  { value: 'apple_podcasts', label: 'Apple Podcasts', isAiGenerated: false },
  { value: 'youtube', label: 'YouTube', isAiGenerated: false },
  { value: 'other', label: 'Other', isAiGenerated: false },
];

export const SOURCE_PLATFORM_HELP: Partial<Record<SourcePlatformValue, string>> = {
  notebooklm:
    'In NotebookLM, open your Audio Overview, click the three-dot menu, and select "Download". The file saves as an MP3.',
  spotify:
    'Spotify does not offer direct downloads. Use a third-party tool to save the episode as an MP3, or record the audio output.',
  apple_podcasts:
    'In Apple Podcasts on Mac, right-click a downloaded episode and select "Show in Finder". The file is stored as an M4A.',
  youtube:
    'Use a trusted YouTube-to-MP3 converter to extract the audio track from the video URL.',
};

export interface ImportProgress {
  podcastId: string;
  status: 'IMPORTING' | 'TRANSCRIBING' | 'READY' | 'FAILED';
  progress: number;
  message?: string;
}

export interface TranscriptionResult {
  text: string;
  segments: Array<{
    speaker: string;
    text: string;
    startTime: number;
    endTime: number;
  }>;
  language?: string;
}
