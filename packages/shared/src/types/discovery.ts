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


