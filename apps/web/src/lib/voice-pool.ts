/**
 * Provider-agnostic voice pool with cross-provider ID mapping.
 *
 * Extracted from elevenlabs.ts so that voice selection works regardless
 * of which TTS provider is active.  Each entry carries IDs for every
 * supported provider, metadata for diversity-aware pairing, and a
 * human-readable description used for voice-preview UIs.
 */

export interface VoicePoolEntry {
  name: string;
  ids: {
    elevenlabs: string;
    openai?: string;
  };
  gender: 'male' | 'female';
  accent: 'american' | 'british' | 'australian' | 'indian' | 'african';
  ageRange: 'young' | 'middle' | 'mature';
  character: string;
}

/**
 * Curated voice pool – 16 voices for podcast hosting and expert roles.
 * OpenAI voice IDs map to the closest tonal match in OpenAI's TTS library.
 */
export const VOICE_POOL: VoicePoolEntry[] = [
  // --- Male voices ---
  {
    name: 'Adam',
    ids: { elevenlabs: 'pNInz6obpgDQGcFmaJgB', openai: 'onyx' },
    gender: 'male',
    accent: 'american',
    ageRange: 'middle',
    character: 'warm narrator',
  },
  {
    name: 'Antoni',
    ids: { elevenlabs: 'ErXwobaYiN019PkySvjV', openai: 'echo' },
    gender: 'male',
    accent: 'american',
    ageRange: 'young',
    character: 'friendly conversationalist',
  },
  {
    name: 'Arnold',
    ids: { elevenlabs: 'VR6AewLTigWG4xSOukaG', openai: 'onyx' },
    gender: 'male',
    accent: 'american',
    ageRange: 'mature',
    character: 'authoritative expert',
  },
  {
    name: 'Sam',
    ids: { elevenlabs: 'yoZ06aMxZJJ28mfd3POQ', openai: 'fable' },
    gender: 'male',
    accent: 'american',
    ageRange: 'young',
    character: 'upbeat storyteller',
  },
  {
    name: 'Josh',
    ids: { elevenlabs: 'TxGEqnHWrfWFTfGW9XjX', openai: 'echo' },
    gender: 'male',
    accent: 'american',
    ageRange: 'middle',
    character: 'confident presenter',
  },
  {
    name: 'Charlie',
    ids: { elevenlabs: 'IKne3meq5aSn9XLyUdCD', openai: 'fable' },
    gender: 'male',
    accent: 'australian',
    ageRange: 'young',
    character: 'casual and curious',
  },
  {
    name: 'George',
    ids: { elevenlabs: 'JBFqnCBsd6RMkjVDRZzb', openai: 'onyx' },
    gender: 'male',
    accent: 'british',
    ageRange: 'mature',
    character: 'distinguished professor',
  },
  {
    name: 'Callum',
    ids: { elevenlabs: 'N2lVS1w4EtoT3dr4eOWO', openai: 'echo' },
    gender: 'male',
    accent: 'british',
    ageRange: 'middle',
    character: 'articulate intellectual',
  },
  // --- Female voices ---
  {
    name: 'Bella',
    ids: { elevenlabs: 'EXAVITQu4vr4xnSDxMaL', openai: 'nova' },
    gender: 'female',
    accent: 'american',
    ageRange: 'young',
    character: 'engaging storyteller',
  },
  {
    name: 'Rachel',
    ids: { elevenlabs: '21m00Tcm4TlvDq8ikWAM', openai: 'shimmer' },
    gender: 'female',
    accent: 'american',
    ageRange: 'middle',
    character: 'calm and authoritative',
  },
  {
    name: 'Elli',
    ids: { elevenlabs: 'MF3mGyEYCl7XYWbV9V6O', openai: 'alloy' },
    gender: 'female',
    accent: 'american',
    ageRange: 'young',
    character: 'enthusiastic explainer',
  },
  {
    name: 'Domi',
    ids: { elevenlabs: 'AZnzlk1XvdvUeBnXmlld', openai: 'nova' },
    gender: 'female',
    accent: 'american',
    ageRange: 'young',
    character: 'energetic and playful',
  },
  {
    name: 'Glinda',
    ids: { elevenlabs: 'z9fAnlkpzviPz146aGWa', openai: 'shimmer' },
    gender: 'female',
    accent: 'american',
    ageRange: 'mature',
    character: 'wise mentor',
  },
  {
    name: 'Freya',
    ids: { elevenlabs: 'jsCqWAovK2LkecY7zXl4', openai: 'alloy' },
    gender: 'female',
    accent: 'british',
    ageRange: 'young',
    character: 'witty and sharp',
  },
  {
    name: 'Charlotte',
    ids: { elevenlabs: 'XB0fDUnXU5powFXDhCwa', openai: 'shimmer' },
    gender: 'female',
    accent: 'british',
    ageRange: 'middle',
    character: 'polished professional',
  },
  {
    name: 'Grace',
    ids: { elevenlabs: 'oWAxZDx7w5VEj9dCyTzz', openai: 'nova' },
    gender: 'female',
    accent: 'australian',
    ageRange: 'middle',
    character: 'warm and approachable',
  },
];

export interface VoiceMatchMetadata {
  tone?: 'casual' | 'professional' | 'socratic';
  audienceLevel?: 'beginner' | 'intermediate' | 'expert';
  audience?: 'kids' | 'teens' | 'family' | 'general' | 'nerds' | 'mature';
}

const TONE_KEYWORDS: Record<
  NonNullable<VoiceMatchMetadata['tone']>,
  { preferred: string[]; penalty: string[] }
> = {
  casual: {
    preferred: ['casual', 'friendly', 'playful', 'upbeat', 'curious', 'approachable', 'engaging'],
    penalty: ['authoritative', 'distinguished', 'polished'],
  },
  professional: {
    preferred: ['authoritative', 'confident', 'polished', 'professional', 'calm', 'articulate'],
    penalty: ['playful', 'casual', 'energetic'],
  },
  socratic: {
    preferred: ['professor', 'wise', 'intellectual', 'curious', 'witty', 'sharp', 'articulate'],
    penalty: ['playful', 'upbeat', 'energetic'],
  },
};

/**
 * Score how well a voice's character string matches a tone.
 * Returns +3 for each preferred keyword found, -2 for each penalty keyword.
 */
export function scoreToneMatch(
  character: string,
  tone: NonNullable<VoiceMatchMetadata['tone']>
): number {
  const lower = character.toLowerCase();
  const { preferred, penalty } = TONE_KEYWORDS[tone];
  let score = 0;
  for (const kw of preferred) {
    if (lower.includes(kw)) score += 3;
  }
  for (const kw of penalty) {
    if (lower.includes(kw)) score -= 2;
  }
  return score;
}

/**
 * Score a voice against discovery metadata across three dimensions:
 * tone→character, audienceLevel→ageRange, audience→ageRange.
 */
export function scoreVoice(voice: VoicePoolEntry, metadata: VoiceMatchMetadata): number {
  let score = 0;

  if (metadata.tone) {
    score += scoreToneMatch(voice.character, metadata.tone);
  }

  if (metadata.audienceLevel) {
    switch (metadata.audienceLevel) {
      case 'beginner':
        if (voice.ageRange === 'young') score += 2;
        if (voice.ageRange === 'mature') score -= 1;
        break;
      case 'intermediate':
        if (voice.ageRange === 'middle') score += 2;
        break;
      case 'expert':
        if (voice.ageRange === 'mature') score += 2;
        if (voice.ageRange === 'young') score -= 1;
        break;
    }
  }

  if (metadata.audience) {
    switch (metadata.audience) {
      case 'kids':
      case 'teens':
        if (voice.ageRange === 'young') score += 1;
        if (voice.ageRange === 'mature') score -= 1;
        break;
      case 'mature':
        if (voice.ageRange === 'mature') score += 1;
        if (voice.ageRange === 'young') score -= 1;
        break;
    }
  }

  return score;
}

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Select a diverse voice pair for a podcast using a deterministic seed.
 * When metadata is provided, voices are scored and filtered to a "preferred tier"
 * (within 3 points of the best score) before hash-selecting within that tier.
 * Ensures the host and expert have different voices, preferring opposite genders.
 */
export function selectVoicePair(
  podcastId: string,
  metadata?: VoiceMatchMetadata
): {
  host: VoicePoolEntry;
  expert: VoicePoolEntry;
} {
  const index = hashString(podcastId);

  const hasMetadata =
    metadata && (metadata.tone || metadata.audienceLevel || metadata.audience);

  if (!hasMetadata) {
    const hostIndex = index % VOICE_POOL.length;
    const host = VOICE_POOL[hostIndex];
    const candidates = VOICE_POOL.filter((v) => v.name !== host.name);
    const contrastCandidates = candidates.filter((v) => v.gender !== host.gender);
    const expertPool = contrastCandidates.length > 0 ? contrastCandidates : candidates;
    const expertIndex = (index >>> 8) % expertPool.length;
    const expert = expertPool[expertIndex];
    return { host, expert };
  }

  const scored = VOICE_POOL.map((v) => ({ voice: v, score: scoreVoice(v, metadata!) }));
  const maxScore = Math.max(...scored.map((s) => s.score));
  const tier = scored.filter((s) => s.score >= maxScore - 3).map((s) => s.voice);

  const hostIndex = index % tier.length;
  const host = tier[hostIndex];

  const expertCandidates = tier.filter((v) => v.name !== host.name && v.gender !== host.gender);
  const expertPool =
    expertCandidates.length > 0
      ? expertCandidates
      : VOICE_POOL.filter((v) => v.name !== host.name && v.gender !== host.gender);
  const expertIndex = (index >>> 8) % expertPool.length;
  const expert = expertPool[expertIndex];

  return { host, expert };
}

/**
 * Resolve a provider-specific voice ID from a voice pool entry.
 */
export function resolveVoiceId(entry: VoicePoolEntry, provider: 'elevenlabs' | 'openai'): string {
  return entry.ids[provider] ?? entry.ids.elevenlabs;
}

/**
 * Look up a voice pool entry by any provider ID.
 */
export function findByVoiceId(voiceId: string): VoicePoolEntry | undefined {
  return VOICE_POOL.find((v) => v.ids.elevenlabs === voiceId || v.ids.openai === voiceId);
}
