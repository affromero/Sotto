import type { PodcastSource, PodcastStatus, PodcastVisibility, Speaker, VoiceTrackStatus } from './enums';
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
  aiModel?: string | null;
  ttsProvider?: string | null;
  ttsModel?: string | null;
  language?: string | null;
  aiAutoResolved?: boolean | null;
  ttsAutoResolved?: boolean | null;
  forkedFromId: string | null;
  forkedFrom?: { id: string; title: string } | null;
  isVoiceOnlyFork: boolean;
  ownerIsPro?: boolean;
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
  isVoiceOnlyFork: boolean;
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
  voiceTracks: VoiceTrackSummary[];
  defaultVoiceTrackId: string | null;
}

export interface VoiceTrackContributor {
  id: string;
  name: string | null;
  handle: string | null;
  image: string | null;
}

export interface VoiceTrackSummary {
  id: string;
  name: string;
  status: VoiceTrackStatus;
  audioUrl: string | null;
  duration: number | null;
  ttsProvider: string | null;
  ttsModel: string | null;
  failureReason: string | null;
  voices: Array<{ speaker: string; voiceId: string; provider?: string | null }>;
  contributor: VoiceTrackContributor | null;
  proposalStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED' | null;
  proposalMessage: string | null;
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
  discoveryId?: string;
  voices?: Array<{ speaker: string; voiceId?: string }>;
  ttsProvider?: string;
  ttsModel?: string;
  aiModel?: string;
  visibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  metadata?: {
    topic: string;
    depth?: string;
    audienceLevel?: string;
    audience?: string;
    focusAreas?: string[];
    tone?: string;
    durationTarget?: number;
    sourceUrl?: string;
    sourceContent?: string;
  };
}

export interface GeneratePodcastRequest {
  podcastId: string;
}

export interface AiModelOption {
  id: string;
  displayName: string;
  tier: string;
  isDefault: boolean;
  group?: string;
}

export interface TtsOption {
  id: string;
  displayName: string;
  badge?: string;
  group?: string;
}

export interface ScriptTurn {
  speaker: string;
  text: string;
  direction?: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  gender: 'male' | 'female';
  accent: string;
  ageRange: string;
  character: string;
}
