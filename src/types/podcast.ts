import { PodcastStatus, PodcastVisibility, Speaker } from '@prisma/client';
import { ReferenceData } from './reference';

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
  user: {
    id: string;
    name: string | null;
    image: string | null;
    role?: string;
  };
  tags: Array<{ id: string; name: string; slug: string }>;
}

export interface PodcastDetail extends PodcastSummary {
  saveCount: number;
  forkedFromId: string | null;
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
