export interface DiscoveryMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  chips: string[];
  createdAt: string;
}

export interface DiscoveryMetadata {
  topic: string;
  depth: 'quick_overview' | 'standard' | 'deep_dive';
  audienceLevel: 'beginner' | 'intermediate' | 'expert';
  focusAreas: string[];
  tone: 'casual' | 'professional' | 'socratic';
  durationTarget: number;
  ready: boolean;
}

export interface DiscoveryState {
  messages: DiscoveryMessage[];
  metadata: DiscoveryMetadata | null;
  isLoading: boolean;
  isComplete: boolean;
}
