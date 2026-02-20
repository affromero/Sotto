export interface DiscoveryMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  chips: string[];
  createdAt: string;
}

export interface DiscoveryMetadata {
  topic: string;
  depth: 'eli5' | 'quick_overview' | 'standard' | 'deep_dive';
  audienceLevel: 'beginner' | 'intermediate' | 'expert';
  audience: 'kids' | 'teens' | 'family' | 'general' | 'nerds' | 'mature';
  focusAreas: string[];
  tone: 'casual' | 'professional' | 'socratic';
  durationTarget: number;
  speakers?: Array<{ name: string; description: string }>;
  ready: boolean;
}

export interface DiscoveryState {
  messages: DiscoveryMessage[];
  metadata: DiscoveryMetadata | null;
  isLoading: boolean;
  isComplete: boolean;
}

export interface TasteQuestion {
  id: string;
  text: string;
  /** Clean topic statement derived from the question (e.g. "how X works" instead of "Would you listen to a podcast about how X works?") */
  topic: string;
  tagSlugs: string[];
  category: string;
}

export interface TasteAnswer {
  questionId: string;
  question: string;
  tagSlugs: string[];
  response: 'yes' | 'no' | 'skip';
}
