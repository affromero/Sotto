export interface Podcast {
  id: string;
  title: string;
  topic: string;
  status: string;
  visibility: string;
  source: string | null;
  duration: number | null;
  audioUrl: string | null;
  playCount: number;
  createdAt: string;
  updatedAt: string;
  user?: {
    id: string;
    name: string | null;
    image: string | null;
  };
  tags?: Array<{ tag: { id: string; name: string; slug: string } }>;
}

export interface PodcastDetail extends Podcast {
  segments?: Array<{
    id: string;
    speaker: string;
    text: string;
    order: number;
    audioUrl: string | null;
    duration: number | null;
  }>;
  interactions?: Array<{
    id: string;
    question: string;
    answer: string | null;
    status: string;
    createdAt: string;
  }>;
  isSaved?: boolean;
}

export interface UserProfile {
  id: string;
  name: string | null;
  email: string | null;
  handle: string | null;
  image: string | null;
  bio: string | null;
  podcastCount: number;
  createdAt: string;
}

export interface CreatePodcastParams {
  title: string;
  topic: string;
  depth?: string;
  audience_level?: string;
  tone?: string;
  duration_minutes?: number;
  focus_areas?: string;
  source_url?: string;
}

export interface UpdatePodcastParams {
  title?: string;
  topic?: string;
  visibility?: string;
}
