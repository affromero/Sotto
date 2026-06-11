import { PodcastSource, PodcastStatus, PodcastVisibility } from '@prisma/client';
import { ReferenceData } from './reference';
import type { VocabularyEntryData } from './vocabulary';
import { PodcastVersionSummary } from './version';
import type { VoiceTrackSummary, WordTiming } from '@sotto/shared';

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
  createdAt: string;
  source: PodcastSource;
  isHumanContent: boolean;
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

export interface PodcastDetail extends PodcastSummary {
  saveCount: number;
  failureReason: string | null;
  failedAtStatus?: string | null;
  errorId?: string | null;
  verificationMode?: string;
  currentVersion: number;
  versions: PodcastVersionSummary[];
  segments: SegmentData[];
  interactions: InteractionSummary[];
  references: ReferenceData[];
  vocabularyEntries?: VocabularyEntryData[];
  pdfUrl: string | null;
  videoUrl: string | null;
  musicUrl: string | null;
  musicVolume: number;
  musicBaked: boolean;
  isSaved: boolean;
  voiceTracks: VoiceTrackSummary[];
  defaultVoiceTrackId: string | null;
  originalTrackName: string;
}

export interface SegmentData {
  id: string;
  speaker: string;
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

export interface CreatePodcastRequest {
  title: string;
  topic: string;
  discoveryId: string;
}

export interface VerificationProgressSnapshot {
  total: number;
  checked: number;
  verified: number;
  replaced: number;
  removed: number;
  rejected: number;
  attempt: number;
  maxAttempts: number;
  phase: 'checking' | 'replacing' | 'complete' | 'insufficient';
  failureDetails?: {
    hallucinated: number;
    blockedDomain: number;
    urlNotFound: number;
    replacementFound: number;
  };
}

export interface GeneratePodcastRequest {
  podcastId: string;
}
