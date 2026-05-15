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
        'Sotto: open-source private podcast infrastructure for AI-generated briefings, BYOK keys, private RSS, Q&A interrupts, and podcast importing',
      depth: 'quick_overview',
      audience: 'Potential users discovering Sotto for the first time',
      audienceLevel: 'beginner',
      tone: 'casual',
      focusAreas: [
        'AI podcast generation from any topic or URL',
        'Voice selection and multi-provider TTS',
        'Private RSS feeds for personal podcast apps',
        'Interrupt mid-playback to ask questions',
        'Bring your own keys (BYOK) for self-hosted usage',
        'Hosted infrastructure for users who do not want to operate AI services',
        'Import existing podcasts',
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
        "What's New on Sotto — latest private podcast, briefing, BYOK, and self-hosting improvements",
      depth: 'quick_overview',
      audience: 'Existing Sotto users who want to stay up-to-date',
      audienceLevel: 'intermediate',
      tone: 'casual',
      focusAreas: [
        'Recent feature releases',
        'Platform improvements',
        'Private briefing workflow improvements',
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
        'How Sotto Creates Podcasts — from topic discovery through AI scripting, reference verification, multi-voice audio generation, and final stitching',
      depth: 'standard',
      audience: 'Tech-curious users and developers interested in the generation pipeline',
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
