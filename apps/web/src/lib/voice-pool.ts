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

/**
 * Select a diverse voice pair for a podcast using a deterministic seed.
 * Ensures the host and expert have different voices, preferring opposite
 * genders for auditory contrast.
 */
export function selectVoicePair(podcastId: string): {
  host: VoicePoolEntry;
  expert: VoicePoolEntry;
} {
  let hash = 0;
  for (let i = 0; i < podcastId.length; i++) {
    hash = ((hash << 5) - hash + podcastId.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash);

  const hostIndex = index % VOICE_POOL.length;
  const host = VOICE_POOL[hostIndex];

  const candidates = VOICE_POOL.filter((v) => v.name !== host.name);
  const contrastCandidates = candidates.filter((v) => v.gender !== host.gender);
  const expertPool = contrastCandidates.length > 0 ? contrastCandidates : candidates;
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
