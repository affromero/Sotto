import type { PodcastSource, PodcastStatus, PodcastVisibility, Speaker } from './enums';
import type { ReferenceData } from './reference';
import type { PodcastVersionSummary } from './version';

export interface PodcastSummary {
  id: string;
  title: string;
  topic: string;
  status: PodcastStatus;
  visibility: PodcastVisibility;
  audioUrl: string | null;
  duration: number | null;
  playCount: number;
  likeCount: number;
  forkCount: number;
  createdAt: string;
  source: PodcastSource;
  isHumanContent: boolean;
  sourcePlatform?: string | null;
  aiProvider?: string | null;
  ttsProvider?: string | null;
  language?: string | null;
  forkedFromId: string | null;
  user: {
    id: string;
    name: string | null;
    handle: string | null;
    image: string | null;
    role?: string;
  };
  tags: Array<{ id: string; name: string; slug: string }>;
}

export interface ForkedFromInfo {
  id: string;
  title: string;
  user: {
    id: string;
    name: string | null;
    handle: string | null;
    image: string | null;
  };
}

export interface ForkSummary {
  id: string;
  title: string;
  remixNote: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    handle: string | null;
    image: string | null;
  };
}

export interface PodcastDetail extends PodcastSummary {
  saveCount: number;
  commentCount: number;
  remixNote: string | null;
  forkedFrom: ForkedFromInfo | null;
  forks: ForkSummary[];
  currentVersion: number;
  versions: PodcastVersionSummary[];
  segments: SegmentData[];
  interactions: InteractionSummary[];
  references: ReferenceData[];
  pdfUrl: string | null;
  isLiked: boolean;
  isSaved: boolean;
}

export interface SegmentData {
  id: string;
  speaker: Speaker;
  text: string;
  audioUrl: string | null;
  order: number;
  startTime: number | null;
  duration: number | null;
}

export interface InteractionSummary {
  id: string;
  question: string;
  timestamp: number;
  status: string;
  answer: string | null;
}

export interface CreatePodcastRequest {
  title: string;
  topic: string;
  discoveryId: string;
}

export interface GeneratePodcastRequest {
  podcastId: string;
}
