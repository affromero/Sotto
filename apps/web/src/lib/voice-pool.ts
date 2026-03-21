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
    kittentts?: string;
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
    ids: { elevenlabs: 'pNInz6obpgDQGcFmaJgB', openai: 'onyx', kittentts: 'hugo' },
    gender: 'male',
    accent: 'american',
    ageRange: 'middle',
    character: 'warm narrator',
  },
  {
    name: 'Eric',
    ids: { elevenlabs: 'cjVigY5qzO86Huf0OWal', openai: 'cedar', kittentts: 'bruno' },
    gender: 'male',
    accent: 'american',
    ageRange: 'young',
    character: 'friendly conversationalist',
  },
  {
    name: 'Brian',
    ids: { elevenlabs: 'nPczCjzI2devNBz1zQrb', openai: 'onyx', kittentts: 'jasper' },
    gender: 'male',
    accent: 'american',
    ageRange: 'mature',
    character: 'authoritative expert',
  },
  {
    name: 'Will',
    ids: { elevenlabs: 'bIHbv24MWmeRgasZH58o', openai: 'fable', kittentts: 'leo' },
    gender: 'male',
    accent: 'american',
    ageRange: 'young',
    character: 'upbeat storyteller',
  },
  {
    name: 'Roger',
    ids: { elevenlabs: 'CwhRBWXzGAHq8TQ4Fs17', openai: 'cedar', kittentts: 'jasper' },
    gender: 'male',
    accent: 'american',
    ageRange: 'middle',
    character: 'confident presenter',
  },
  {
    name: 'Charlie',
    ids: { elevenlabs: 'IKne3meq5aSn9XLyUdCD', openai: 'fable', kittentts: 'bruno' },
    gender: 'male',
    accent: 'australian',
    ageRange: 'young',
    character: 'casual and curious',
  },
  {
    name: 'George',
    ids: { elevenlabs: 'JBFqnCBsd6RMkjVDRZzb', openai: 'onyx', kittentts: 'hugo' },
    gender: 'male',
    accent: 'british',
    ageRange: 'mature',
    character: 'distinguished professor',
  },
  {
    name: 'Callum',
    ids: { elevenlabs: 'N2lVS1w4EtoT3dr4eOWO', openai: 'echo', kittentts: 'leo' },
    gender: 'male',
    accent: 'british',
    ageRange: 'middle',
    character: 'articulate intellectual',
  },
  // --- Female voices ---
  {
    name: 'Aria',
    ids: { elevenlabs: '9BWtsMINqrJLrRacOk9x', openai: 'nova', kittentts: 'bella' },
    gender: 'female',
    accent: 'american',
    ageRange: 'young',
    character: 'engaging storyteller',
  },
  {
    name: 'Rachel',
    ids: { elevenlabs: '21m00Tcm4TlvDq8ikWAM', openai: 'shimmer', kittentts: 'rosie' },
    gender: 'female',
    accent: 'american',
    ageRange: 'middle',
    character: 'calm and authoritative',
  },
  {
    name: 'Jessica',
    ids: { elevenlabs: 'cgSgspJ2msm6clMCkdW9', openai: 'marin', kittentts: 'kiki' },
    gender: 'female',
    accent: 'american',
    ageRange: 'young',
    character: 'enthusiastic explainer',
  },
  {
    name: 'Laura',
    ids: { elevenlabs: 'FGY2WhTYpPnrIDTdsKH5', openai: 'nova', kittentts: 'luna' },
    gender: 'female',
    accent: 'american',
    ageRange: 'young',
    character: 'energetic and playful',
  },
  {
    name: 'Matilda',
    ids: { elevenlabs: 'XrExE9yKIg1WjnnlVkGX', openai: 'shimmer', kittentts: 'rosie' },
    gender: 'female',
    accent: 'american',
    ageRange: 'mature',
    character: 'wise mentor',
  },
  {
    name: 'Alice',
    ids: { elevenlabs: 'Xb7hH8MSUJpSbSDYk0k2', openai: 'marin', kittentts: 'kiki' },
    gender: 'female',
    accent: 'british',
    ageRange: 'young',
    character: 'witty and sharp',
  },
  {
    name: 'Charlotte',
    ids: { elevenlabs: 'XB0fDUnXU5powFXDhCwa', openai: 'shimmer', kittentts: 'luna' },
    gender: 'female',
    accent: 'british',
    ageRange: 'middle',
    character: 'polished professional',
  },
  {
    name: 'Grace',
    ids: { elevenlabs: 'oWAxZDx7w5VEj9dCyTzz', openai: 'nova', kittentts: 'bella' },
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
 * Select N diverse voices for a podcast using a deterministic seed.
 * Alternates genders and avoids duplicate voices.
 */
export function selectVoiceSet(
  podcastId: string,
  speakerCount: number,
  metadata?: VoiceMatchMetadata
): VoicePoolEntry[] {
  const count = Math.max(1, Math.min(speakerCount, VOICE_POOL.length));
  const index = hashString(podcastId);

  const hasMetadata =
    metadata && (metadata.tone || metadata.audienceLevel || metadata.audience);

  const pool = hasMetadata
    ? (() => {
        const scored = VOICE_POOL.map((v) => ({ voice: v, score: scoreVoice(v, metadata!) }));
        const maxScore = Math.max(...scored.map((s) => s.score));
        return scored.filter((s) => s.score >= maxScore - 3).map((s) => s.voice);
      })()
    : VOICE_POOL;

  const selected: VoicePoolEntry[] = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < count; i++) {
    const wantGender = i % 2 === 0 ? 'female' : 'male';
    const candidates = pool.filter(
      (v) => !usedNames.has(v.name) && v.gender === wantGender
    );
    const fallback = pool.filter((v) => !usedNames.has(v.name));
    const pickFrom = candidates.length > 0 ? candidates : fallback;
    if (pickFrom.length === 0) break;
    const pick = pickFrom[(index >>> (i * 4)) % pickFrom.length];
    selected.push(pick);
    usedNames.add(pick.name);
  }

  return selected;
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
export function resolveVoiceId(
  entry: VoicePoolEntry,
  provider: 'elevenlabs' | 'openai' | 'kittentts'
): string {
  return entry.ids[provider] ?? entry.ids.elevenlabs;
}

/**
 * Look up a voice pool entry by any provider ID.
 */
export function findByVoiceId(voiceId: string): VoicePoolEntry | undefined {
  return VOICE_POOL.find(
    (v) => v.ids.elevenlabs === voiceId || v.ids.openai === voiceId || v.ids.kittentts === voiceId
  );
}

// ---------------------------------------------------------------------------
// KittenTTS-specific voice pool
// KittenTTS mini ships with 8 named voices — 4 host (warm/conversational),
// 4 expert (authoritative). Deterministic pairing via podcast ID hash.
// ---------------------------------------------------------------------------

export interface KittenVoicePoolEntry {
  id: string;
  gender: 'male' | 'female';
}

export const KITTENTTS_VOICE_POOL: KittenVoicePoolEntry[] = [
  { id: 'bella', gender: 'female' },
  { id: 'rosie', gender: 'female' },
  { id: 'kiki', gender: 'female' },
  { id: 'luna', gender: 'female' },
  { id: 'jasper', gender: 'male' },
  { id: 'bruno', gender: 'male' },
  { id: 'hugo', gender: 'male' },
  { id: 'leo', gender: 'male' },
];

/**
 * Select N diverse KittenTTS voices for a podcast using a deterministic seed.
 * Alternates genders and avoids duplicate voices.
 */
export function selectKittenVoiceSet(podcastId: string, speakerCount: number): string[] {
  const count = Math.max(1, Math.min(speakerCount, KITTENTTS_VOICE_POOL.length));
  const index = hashString(podcastId);
  const selected: string[] = [];
  const usedIds = new Set<string>();

  for (let i = 0; i < count; i++) {
    const wantGender = i % 2 === 0 ? 'female' : 'male';
    const candidates = KITTENTTS_VOICE_POOL.filter(
      (v) => !usedIds.has(v.id) && v.gender === wantGender
    );
    const fallback = KITTENTTS_VOICE_POOL.filter((v) => !usedIds.has(v.id));
    const pickFrom = candidates.length > 0 ? candidates : fallback;
    if (pickFrom.length === 0) break;
    const pick = pickFrom[(index >>> (i * 4)) % pickFrom.length];
    selected.push(pick.id);
    usedIds.add(pick.id);
  }

  return selected;
}

/**
 * Select a deterministic KittenTTS host/expert voice pair for a podcast.
 * Wrapper around selectKittenVoiceSet for backward compatibility.
 */
export function selectKittenVoicePair(podcastId: string): { host: string; expert: string } {
  const voices = selectKittenVoiceSet(podcastId, 2);
  return { host: voices[0], expert: voices[1] };
}
