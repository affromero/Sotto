export interface MarketingTemplate {
  id: string;
  name: string;
  description: string;
  metadata: {
    topic: string;
    depth: string;
    audience: string;
    audienceLevel: string;
    tone: string;
    focusAreas: string[];
    durationTarget: number;
    speakers: Array<{ name: string; description: string }>;
  };
}

export const MARKETING_TEMPLATES: MarketingTemplate[] = [
  {
    id: 'features-overview',
    name: 'Sotto Features Overview',
    description: '2 min overview of all platform features',
    metadata: {
      topic:
        'Sotto: open-source, self-hostable language learning — context-aware CEFR courses taught through the AI agent that already knows your work and interests, with BYOK keys and full data ownership',
      depth: 'quick_overview',
      audience: 'Potential learners discovering Sotto for the first time',
      audienceLevel: 'beginner',
      tone: 'casual',
      focusAreas: [
        'Context-aware language courses built around your own projects and interests',
        'Mastery-gated CEFR grammar, reading, listening, and speaking modules',
        'Connect Claude Code, Codex, or another local agent via MCP',
        'Adaptive listening lessons generated from your topics',
        'Pronunciation feedback with speaking exercises',
        'Personal vocabulary memory graph with spaced-repetition review',
        'Bring your own keys (BYOK) for self-hosted usage',
      ],
      durationTarget: 2,
      speakers: [
        { name: 'Host', description: 'Warm and enthusiastic guide who introduces Sotto' },
        {
          name: 'Expert',
          description: 'Product expert who explains features with concrete examples',
        },
      ],
    },
  },
  {
    id: 'whats-new',
    name: "What's New",
    description: '1 min update on recent changes',
    metadata: {
      topic:
        "What's New on Sotto — latest language-learning features, BYOK, and self-hosting improvements",
      depth: 'quick_overview',
      audience: 'Existing Sotto users who want to stay up-to-date',
      audienceLevel: 'intermediate',
      tone: 'casual',
      focusAreas: [
        'Recent feature releases',
        'Platform improvements',
        'Language-learning and course workflow improvements',
      ],
      durationTarget: 1,
      speakers: [
        { name: 'Host', description: 'Friendly host who keeps it brief and upbeat' },
        { name: 'Expert', description: 'Developer who shares behind-the-scenes context' },
      ],
    },
  },
  {
    id: 'how-it-works',
    name: 'How It Works',
    description: '3 min explainer of the generation pipeline',
    metadata: {
      topic:
        'How Sotto Builds Language Courses — from agent context and CEFR placement through AI scripting, reference verification, multi-voice audio generation, and spaced-repetition review',
      depth: 'standard',
      audience: 'Tech-curious learners and developers interested in the course generation pipeline',
      audienceLevel: 'intermediate',
      tone: 'professional',
      focusAreas: [
        'Discovery chat — AI guides topic refinement',
        'Content extraction from URLs and documents',
        'Script generation with citations and references',
        'Script verification loop for accuracy',
        'Reference validation against real sources',
        'Multi-provider TTS audio generation',
        'Audio stitching with crossfades and sound design',
      ],
      durationTarget: 3,
      speakers: [
        { name: 'Host', description: 'Curious interviewer asking the right questions' },
        { name: 'Expert', description: 'Technical expert who explains the pipeline clearly' },
      ],
    },
  },
];
