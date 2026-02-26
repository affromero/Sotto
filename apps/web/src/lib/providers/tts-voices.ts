/**
 * Per-provider voice pools for podcast generation.
 *
 * Each provider has a curated set of voices. The `selectVoicePairFromPool`
 * function uses the same deterministic hash as the ElevenLabs/OpenAI
 * voice pool in voice-pool.ts, ensuring consistent voice selection.
 */

import { scoreToneMatch, type VoiceMatchMetadata } from '../voice-pool';

export interface ProviderVoice {
  id: string;
  name: string;
  gender: 'male' | 'female';
  character: string;
}

// ---------------------------------------------------------------------------
// Cartesia voices — curated subset of Cartesia's voice library
// ---------------------------------------------------------------------------

export const CARTESIA_VOICE_POOL: ProviderVoice[] = [
  {
    id: 'a0e99841-438c-4a64-b679-ae501e7d6091',
    name: 'Barbershop Man',
    gender: 'male',
    character: 'warm narrator',
  },
  {
    id: '79a125e8-cd45-4c13-8a67-188112f4dd22',
    name: 'British Lady',
    gender: 'female',
    character: 'polished professional',
  },
  {
    id: '87748186-23bb-4571-8b6c-95265081c5b3',
    name: 'Confident Man',
    gender: 'male',
    character: 'confident presenter',
  },
  {
    id: '694f9389-aac1-45b6-b726-9d9369183238',
    name: 'Friendly Sidekick',
    gender: 'female',
    character: 'friendly conversationalist',
  },
  {
    id: 'f9836c6e-a0bd-460e-9d3c-f7299fa60f94',
    name: 'Wise Guide',
    gender: 'male',
    character: 'authoritative expert',
  },
  {
    id: 'b7d50908-b17c-442d-ad8d-7c56a2ec603f',
    name: 'Calm Lady',
    gender: 'female',
    character: 'calm and authoritative',
  },
  {
    id: '638efaaa-4d0c-442e-b701-3fae16aad012',
    name: 'Young Narrator',
    gender: 'male',
    character: 'upbeat storyteller',
  },
  {
    id: '248be419-c632-4f23-adf1-5324ed7dbf1d',
    name: 'Enthusiastic Woman',
    gender: 'female',
    character: 'enthusiastic explainer',
  },
  {
    id: 'c45bc5ec-dc68-4feb-8829-6e6b2748095d',
    name: 'Thoughtful Man',
    gender: 'male',
    character: 'articulate intellectual',
  },
  {
    id: 'e3827ec5-697a-4b7c-9c82-4a5e3c63c5e4',
    name: 'Lively Narrator',
    gender: 'female',
    character: 'engaging storyteller',
  },
];

// ---------------------------------------------------------------------------
// Hume AI voices — curated subset from Hume's 160+ voice library (Octave 2)
// IDs are Hume voice UUIDs, used with voice: { id } in the API
// ---------------------------------------------------------------------------

export const HUME_VOICE_POOL: ProviderVoice[] = [
  { id: 'ee96fb5f-ec1a-4f41-a9ba-6d119e64c8fd', name: 'Vince Douglas', gender: 'male', character: 'confident presenter' },
  { id: 'b201d214-914c-4d0a-b8e4-54adfc14a0dd', name: 'Inspiring Woman', gender: 'female', character: 'warm narrator' },
  { id: '01854384-4e4e-48d4-90d1-b22f760a58b5', name: 'Male Podcaster', gender: 'male', character: 'authoritative expert' },
  { id: '33045fd9-8010-43f6-b6b0-da3fbf326c29', name: 'Casual Podcast Host', gender: 'female', character: 'friendly conversationalist' },
  { id: '176a55b1-4468-4736-8878-db82729667c1', name: 'Nature Documentary Narrator', gender: 'male', character: 'polished professional' },
  { id: 'f3f69312-095c-4ec3-8e50-6961c676e898', name: 'Cool Journalist', gender: 'female', character: 'engaging storyteller' },
  { id: '99d2cb9c-9011-4ead-8734-641656d3df66', name: 'Comforting Male Conversationalist', gender: 'male', character: 'warm narrator' },
  { id: 'd6fd5cc2-53e6-4e80-ba83-93972682386a', name: 'Demure Conversationalist', gender: 'female', character: 'polished professional' },
  { id: '15f594d3-0683-4585-b799-ce12e939a0e2', name: 'Brooding Intellectual Man', gender: 'male', character: 'articulate intellectual' },
  { id: '8a7dd58c-0cda-4073-9ce6-654184695e99', name: 'Warm American Female', gender: 'female', character: 'enthusiastic explainer' },
  { id: 'fcd2297b-44dd-4115-97af-a13297afb8cb', name: 'Classical Film Actor', gender: 'male', character: 'engaging storyteller' },
  { id: 'f042c0be-b7cc-4a59-bea2-65f23e12c710', name: 'Donovan Sinclair', gender: 'male', character: 'casual and curious' },
];

// ---------------------------------------------------------------------------
// Qwen3-TTS voices — shared by Fal and Replicate (same model, same voices)
// ---------------------------------------------------------------------------

export const FAL_VOICE_POOL: ProviderVoice[] = [
  { id: 'Vivian', name: 'Vivian', gender: 'female', character: 'warm narrator' },
  { id: 'Serena', name: 'Serena', gender: 'female', character: 'polished professional' },
  { id: 'Dylan', name: 'Dylan', gender: 'male', character: 'confident presenter' },
  { id: 'Eric', name: 'Eric', gender: 'male', character: 'authoritative expert' },
  { id: 'Ryan', name: 'Ryan', gender: 'male', character: 'friendly conversationalist' },
  { id: 'Aiden', name: 'Aiden', gender: 'male', character: 'casual and curious' },
  { id: 'Ono_Anna', name: 'Ono Anna', gender: 'female', character: 'enthusiastic explainer' },
  { id: 'Sohee', name: 'Sohee', gender: 'female', character: 'engaging storyteller' },
  { id: 'Uncle_Fu', name: 'Uncle Fu', gender: 'male', character: 'wise mentor' },
];

// ---------------------------------------------------------------------------
// Provider voice scoring (tone-character only, no ageRange/accent)
// ---------------------------------------------------------------------------

function scoreProviderVoice(voice: ProviderVoice, metadata: VoiceMatchMetadata): number {
  if (!metadata.tone) return 0;
  return scoreToneMatch(voice.character, metadata.tone);
}

// ---------------------------------------------------------------------------
// Generic voice pair selection (works with any provider voice pool)
// ---------------------------------------------------------------------------

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Select N diverse voices from a provider-specific voice pool.
 * Alternates genders and avoids duplicate voices. When metadata is
 * provided, voices are scored by tone-character match and filtered
 * to a preferred tier before hash-selecting.
 */
export function selectVoiceSetFromPool(
  pool: ProviderVoice[],
  podcastId: string,
  speakerCount: number,
  metadata?: VoiceMatchMetadata
): ProviderVoice[] {
  const count = Math.max(1, Math.min(speakerCount, pool.length));
  const index = hashString(podcastId);

  const hasMetadata = metadata && metadata.tone;

  const filtered = hasMetadata
    ? (() => {
        const scored = pool.map((v) => ({ voice: v, score: scoreProviderVoice(v, metadata!) }));
        const maxScore = Math.max(...scored.map((s) => s.score));
        return scored.filter((s) => s.score >= maxScore - 3).map((s) => s.voice);
      })()
    : pool;

  const selected: ProviderVoice[] = [];
  const usedIds = new Set<string>();

  for (let i = 0; i < count; i++) {
    const wantGender = i % 2 === 0 ? 'female' : 'male';
    const candidates = filtered.filter(
      (v) => !usedIds.has(v.id) && v.gender === wantGender
    );
    const fallback = filtered.filter((v) => !usedIds.has(v.id));
    const pickFrom = candidates.length > 0 ? candidates : fallback;
    if (pickFrom.length === 0) break;
    const pick = pickFrom[(index >>> (i * 4)) % pickFrom.length];
    selected.push(pick);
    usedIds.add(pick.id);
  }

  return selected;
}

/**
 * Select a diverse voice pair from a provider-specific voice pool.
 * Wrapper around selectVoiceSetFromPool for backward compatibility.
 * When metadata is provided, voices are scored by tone-character match
 * and filtered to a preferred tier before hash-selecting.
 */
export function selectVoicePairFromPool(
  pool: ProviderVoice[],
  podcastId: string,
  metadata?: VoiceMatchMetadata
): { host: ProviderVoice; expert: ProviderVoice } {
  const index = hashString(podcastId);

  const hasMetadata = metadata && metadata.tone;

  if (!hasMetadata) {
    const hostIndex = index % pool.length;
    const host = pool[hostIndex];
    const candidates = pool.filter((v) => v.id !== host.id);
    const contrastCandidates = candidates.filter((v) => v.gender !== host.gender);
    const expertPool = contrastCandidates.length > 0 ? contrastCandidates : candidates;
    const expertIndex = (index >>> 8) % expertPool.length;
    const expert = expertPool[expertIndex];
    return { host, expert };
  }

  const scored = pool.map((v) => ({ voice: v, score: scoreProviderVoice(v, metadata!) }));
  const maxScore = Math.max(...scored.map((s) => s.score));
  const tier = scored.filter((s) => s.score >= maxScore - 3).map((s) => s.voice);

  const hostIndex = index % tier.length;
  const host = tier[hostIndex];

  const expertCandidates = tier.filter((v) => v.id !== host.id && v.gender !== host.gender);
  const expertPool =
    expertCandidates.length > 0
      ? expertCandidates
      : pool.filter((v) => v.id !== host.id && v.gender !== host.gender);
  const expertIndex = (index >>> 8) % expertPool.length;
  const expert = expertPool[expertIndex];

  return { host, expert };
}
