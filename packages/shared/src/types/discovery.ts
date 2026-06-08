export interface DiscoveryMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  chips: string[];
  createdAt: string;
}

export type VerificationMode = 'standard' | 'relaxed' | 'showcase';

export interface DiscoveryMetadata {
  topic: string;
  depth: 'eli5' | 'quick_overview' | 'standard' | 'deep_dive';
  audienceLevel: 'beginner' | 'intermediate' | 'expert';
  audience: 'kids' | 'teens' | 'family' | 'general' | 'nerds' | 'mature';
  focusAreas: string[];
  tone: 'casual' | 'professional' | 'socratic' | 'comedic' | 'satirical' | 'storytelling';
  durationTarget: number;
  speakers?: Array<{ name: string; description: string }>;
  /** LLM-suggested format: 1=Solo, 2=Dialogue, 3=Panel, 4=Roundtable */
  suggestedFormat?: 1 | 2 | 3 | 4;
  verificationMode?: VerificationMode;
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
  /** Article URL from newsletter feeds (news questions only) */
  sourceUrl?: string;
  /** Source publication name, e.g. "Reuters", "NPR" (news questions only) */
  sourceName?: string;
}

export interface TasteAnswer {
  questionId: string;
  question: string;
  tagSlugs: string[];
  response: 'yes' | 'no' | 'skip';
}

export type InspireSection = 'forYou' | 'trending' | 'curiosity';

export const INSPIRE_SECTION_LABELS: Record<InspireSection, string> = {
  forYou: 'For You',
  trending: 'Trending',
  curiosity: 'Curiosity',
};
