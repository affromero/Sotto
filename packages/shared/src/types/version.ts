export interface EpisodeVersionSummary {
  id: string;
  version: number;
  audioUrl: string;
  duration: number | null;
  changeType: string;
  changeSummary: string | null;
  interactionId: string | null;
  createdAt: string;
}

export interface EpisodeVersionDetail extends EpisodeVersionSummary {
  segments: Array<{
    segmentId: string;
    order: number;
    startTime: number | null;
  }>;
}
