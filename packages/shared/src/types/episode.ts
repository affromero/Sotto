import type { EpisodeSource, EpisodeStatus, EpisodeVisibility, Speaker } from './enums';
import type { ReferenceData } from './reference';
import type { EpisodeVersionSummary } from './version';

export interface EpisodeSummary {
  id: string;
  title: string;
  topic: string;
  status: EpisodeStatus;
  visibility: EpisodeVisibility;
  audioUrl: string | null;
  duration: number | null;
  createdAt: string;
  source: EpisodeSource;
  lowReferences?: boolean;
  sourcePlatform?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
  ttsProvider?: string | null;
  ttsModel?: string | null;
  language?: string | null;
  aiAutoResolved?: boolean | null;
  ttsAutoResolved?: boolean | null;
  user: {
    id: string;
    name: string | null;
    handle: string | null;
    image: string | null;
    role?: string;
  };
  tags: Array<{ id: string; name: string; slug: string }>;
}

export interface EpisodeDetail extends EpisodeSummary {
  currentVersion: number;
  versions: EpisodeVersionSummary[];
  segments: SegmentData[];
  interactions: InteractionSummary[];
  references: ReferenceData[];
  pdfUrl: string | null;
  isSaved: boolean;
  /** Owner-only: reason the generation pipeline failed (null for non-owners or non-failed episodes) */
  failureReason?: string | null;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface SegmentData {
  id: string;
  speaker: Speaker;
  text: string;
  audioUrl: string | null;
  order: number;
  startTime: number | null;
  duration: number | null;
  wordTimings?: WordTiming[] | null;
}

export interface InteractionSummary {
  id: string;
  question: string;
  timestamp: number;
  status: string;
  answer: string | null;
}

export interface CreateEpisodeRequest {
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

export interface GenerateEpisodeRequest {
  episodeId: string;
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
