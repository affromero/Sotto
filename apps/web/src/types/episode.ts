import { EpisodeSource, EpisodeStatus, EpisodeVisibility } from '@/generated/prisma/client';
import { ReferenceData } from './reference';
import type { VocabularyEntryData } from './vocabulary';
import { EpisodeVersionSummary } from './version';
import type { WordTiming } from '@sotto/shared';

export interface EpisodeSummary {
  id: string;
  title: string;
  topic: string;
  slug?: string | null;
  status: EpisodeStatus;
  visibility: EpisodeVisibility;
  audioUrl: string | null;
  duration: number | null;
  playCount: number;
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
  saveCount: number;
  failureReason: string | null;
  failedAtStatus?: string | null;
  errorId?: string | null;
  verificationMode?: string;
  currentVersion: number;
  versions: EpisodeVersionSummary[];
  segments: SegmentData[];
  interactions: InteractionSummary[];
  references: ReferenceData[];
  vocabularyEntries?: VocabularyEntryData[];
  pdfUrl: string | null;
  isSaved: boolean;
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

export interface CreateEpisodeRequest {
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

export interface GenerateEpisodeRequest {
  episodeId: string;
}
