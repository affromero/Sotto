export interface PodcastVersionSummary {
  id: string;
  version: number;
  audioUrl: string;
  duration: number | null;
  changeType: string;
  changeSummary: string | null;
  interactionId: string | null;
  createdAt: string;
}

export interface PodcastVersionDetail extends PodcastVersionSummary {
  segments: Array<{
    segmentId: string;
    order: number;
    startTime: number | null;
  }>;
}
