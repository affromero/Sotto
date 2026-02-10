export interface ImportPodcastRequest {
  title: string;
  topic: string;
  isHumanContent: boolean;
}

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
