import { PodcastSource, PodcastStatus, PodcastVisibility } from '@prisma/client';
import { ReferenceData } from './reference';
import { PodcastVersionSummary } from './version';
import type { VoiceTrackSummary } from '@sotto/shared';

export type { VoiceTrackSummary };

export interface PodcastSummary {
  id: string;
  title: string;
  topic: string;
  slug?: string | null;
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
  aiModel?: string | null;
  ttsProvider?: string | null;
  ttsModel?: string | null;
  language?: string | null;
  aiAutoResolved?: boolean | null;
  ttsAutoResolved?: boolean | null;
  forkedFromId: string | null;
  forkedFrom?: { id: string; title: string } | null;
  isVoiceOnlyFork?: boolean;
  ownerIsPro: boolean;
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
  isVoiceOnlyFork?: boolean;
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
  failureReason: string | null;
  failedAtStatus?: string | null;
  errorId?: string | null;
  verificationMode?: string;
  forkedFrom: ForkedFromInfo | null;
  forks: ForkSummary[];
  currentVersion: number;
  versions: PodcastVersionSummary[];
  segments: SegmentData[];
  interactions: InteractionSummary[];
  references: ReferenceData[];
  pdfUrl: string | null;
  videoUrl: string | null;
  musicUrl: string | null;
  musicVolume: number;
  isLiked: boolean;
  isSaved: boolean;
  voiceTracks: VoiceTrackSummary[];
  defaultVoiceTrackId: string | null;
}

export interface SegmentData {
  id: string;
  speaker: string;
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
