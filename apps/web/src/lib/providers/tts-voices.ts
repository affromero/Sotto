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

// Verified against Cartesia API (2025-04-16). 16 voices: 8 male, 8 female.
// Previous pool had 7/10 deleted voice IDs — fully rebuilt with confirmed UUIDs.
export const CARTESIA_VOICE_POOL: ProviderVoice[] = [
  // Male voices
  { id: '98a34ef2-2140-4c28-9c71-663dc4dd7022', name: 'Clyde', gender: 'male', character: 'warm narrator' },
  { id: '228fca29-3a0a-435c-8728-5cb483251068', name: 'Kiefer', gender: 'male', character: 'authoritative expert' },
  { id: '79f8b5fb-2cc8-479a-80df-29f7a7cf1a3e', name: 'Theo', gender: 'male', character: 'confident presenter' },
  { id: 'c961b81c-a935-4c17-bfb3-ba2239de8c2f', name: 'Kyle', gender: 'male', character: 'friendly conversationalist' },
  { id: '5ee9feff-1265-424a-9d7f-8e4d431a12c7', name: 'Ronald', gender: 'male', character: 'articulate intellectual' },
  { id: '0ad65e7f-006c-47cf-bd31-52279d487913', name: 'Rupert', gender: 'male', character: 'warm mentor' },
  { id: '565510e8-6b45-45de-8758-13588fbaec73', name: 'Ray', gender: 'male', character: 'casual and curious' },
  { id: '5cad89c9-d88a-4832-89fb-55f2f16d13d3', name: 'Brandon', gender: 'male', character: 'polished professional' },
  // Female voices
  { id: 'a33f7a4c-100f-41cf-a1fd-5822e8fc253f', name: 'Lauren', gender: 'female', character: 'engaging storyteller' },
  { id: '6ccbfb76-1fc6-48f7-b71d-91ac6298247b', name: 'Tessa', gender: 'female', character: 'friendly conversationalist' },
  { id: '26403c37-80c1-4a1a-8692-540551ca2ae5', name: 'Marian', gender: 'female', character: 'polished professional' },
  { id: '62ae83ad-4f6a-430b-af41-a9bede9286ca', name: 'Gemma', gender: 'female', character: 'authoritative expert' },
  { id: 'e07c00bc-4134-4eae-9ea4-1a55fb45746b', name: 'Brooke', gender: 'female', character: 'warm narrator' },
  { id: 'a7b8d8fa-f6e5-4908-900e-0c11d1d82519', name: 'Joanie', gender: 'female', character: 'enthusiastic explainer' },
  { id: '2f251ac3-89a9-4a77-a452-704b474ccd01', name: 'Lucy', gender: 'female', character: 'calm and authoritative' },
  { id: 'f786b574-daa5-4673-aa0c-cbe3e8534c02', name: 'Katie', gender: 'female', character: 'upbeat storyteller' },
];

// ---------------------------------------------------------------------------
// Hume AI voices — curated subset from Hume's 160+ voice library (Octave 2)
// IDs are Hume voice UUIDs, used with voice: { id } in the API
// ---------------------------------------------------------------------------

export const HUME_VOICE_POOL: ProviderVoice[] = [
  { id: 'ee96fb5f-ec1a-4f41-a9ba-6d119e64c8fd', name: 'Vince Douglas', gender: 'male', character: 'confident presenter' },
  { id: 'b201d214-914c-4d0a-b8e4-54adfc14a0dd', name: 'Inspiring Woman', gender: 'female', character: 'warm narrator' },
  { id: '01854384-4e4e-48d4-90d1-b22f760a58b5', name: 'Male Narrator', gender: 'male', character: 'authoritative expert' },
  { id: '33045fd9-8010-43f6-b6b0-da3fbf326c29', name: 'Casual Narrator', gender: 'female', character: 'friendly conversationalist' },
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
// Inworld TTS 1.5 voices — 4 preset voices (2 male, 2 female)
// Used by Replicate Inworld models (tts-1.5-max, tts-1.5-mini)
// ---------------------------------------------------------------------------

export const INWORLD_VOICE_POOL: ProviderVoice[] = [
  { id: 'Ashley', name: 'Ashley', gender: 'female', character: 'warm narrator' },
  { id: 'Dennis', name: 'Dennis', gender: 'male', character: 'polished professional' },
  { id: 'Alex', name: 'Alex', gender: 'male', character: 'energetic presenter' },
  { id: 'Darlene', name: 'Darlene', gender: 'female', character: 'soothing storyteller' },
];

// ---------------------------------------------------------------------------
// MiniMax Speech-02 HD voices — 12 curated from 17 presets (6 male, 6 female)
// ---------------------------------------------------------------------------

export const MINIMAX_VOICE_POOL: ProviderVoice[] = [
  // Male voices
  { id: 'Deep_Voice_Man', name: 'Deep Voice Man', gender: 'male', character: 'authoritative expert' },
  { id: 'Casual_Guy', name: 'Casual Guy', gender: 'male', character: 'casual and curious' },
  { id: 'Patient_Man', name: 'Patient Man', gender: 'male', character: 'warm narrator' },
  { id: 'Elegant_Man', name: 'Elegant Man', gender: 'male', character: 'polished professional' },
  { id: 'Young_Knight', name: 'Young Knight', gender: 'male', character: 'confident presenter' },
  { id: 'Determined_Man', name: 'Determined Man', gender: 'male', character: 'enthusiastic explainer' },
  // Female voices
  { id: 'Wise_Woman', name: 'Wise Woman', gender: 'female', character: 'warm narrator' },
  { id: 'Calm_Woman', name: 'Calm Woman', gender: 'female', character: 'calm and authoritative' },
  { id: 'Lively_Girl', name: 'Lively Girl', gender: 'female', character: 'engaging storyteller' },
  { id: 'Inspirational_girl', name: 'Inspirational Girl', gender: 'female', character: 'enthusiastic explainer' },
  { id: 'Friendly_Person', name: 'Friendly Person', gender: 'female', character: 'friendly conversationalist' },
  { id: 'Lovely_Girl', name: 'Lovely Girl', gender: 'female', character: 'polished professional' },
];

// ---------------------------------------------------------------------------
// Mistral Voxtral TTS voices — voice_id values for the Mistral API.
// ---------------------------------------------------------------------------

// Verified against Mistral API 2026-03-29. Preset voices (user_id=null).
// IDs are UUIDs from GET /v1/audio/voices. Limited female presets currently.
export const MISTRAL_VOICE_POOL: ProviderVoice[] = [
  // Paul — en_us male, diverse emotions for podcast variety
  { id: 'c69964a6-ab8b-4f8a-9465-ec0925096ec8', name: 'Paul (Neutral)', gender: 'male', character: 'polished professional' },
  { id: '98559b22-62b5-4a64-a7cd-fc78ca41faa8', name: 'Paul (Confident)', gender: 'male', character: 'authoritative expert' },
  { id: '01d985cd-5e0c-4457-bfd8-80ba31a5bc03', name: 'Paul (Cheerful)', gender: 'male', character: 'friendly conversationalist' },
  { id: '5940190b-f58a-4c3e-8264-a40d63fd6883', name: 'Paul (Excited)', gender: 'male', character: 'enthusiastic explainer' },
  // Oliver — en_gb male
  { id: 'e3596645-b1af-469e-b857-f18ddedc7652', name: 'Oliver (Neutral)', gender: 'male', character: 'warm narrator' },
  // Jane — en_gb female (only female preset currently available)
  { id: 'a3e41ea8-020b-44c0-8d8b-f6cc03524e31', name: 'Jane (Sarcasm)', gender: 'female', character: 'engaging storyteller' },
];

// ---------------------------------------------------------------------------
// Kokoro-82M voices — local sidecar (keyless). Voice ids follow Kokoro's
// `{lang}{gender}_{name}` convention; the sidecar derives the synthesis language
// from the id prefix. Curated cross-section across the 8 supported languages
// (en/es/fr/it/pt/hi/ja/zh), balanced by gender. Voices are cross-lingual.
// ---------------------------------------------------------------------------

export const KOKORO_VOICE_POOL: ProviderVoice[] = [
  // English (US + UK)
  { id: 'af_heart', name: 'Heart', gender: 'female', character: 'warm narrator' },
  { id: 'af_bella', name: 'Bella', gender: 'female', character: 'engaging storyteller' },
  { id: 'am_adam', name: 'Adam', gender: 'male', character: 'confident presenter' },
  { id: 'am_michael', name: 'Michael', gender: 'male', character: 'authoritative expert' },
  { id: 'bf_emma', name: 'Emma', gender: 'female', character: 'polished professional' },
  { id: 'bm_george', name: 'George', gender: 'male', character: 'warm mentor' },
  // Spanish
  { id: 'ef_dora', name: 'Dora', gender: 'female', character: 'friendly conversationalist' },
  { id: 'em_alex', name: 'Alex', gender: 'male', character: 'casual and curious' },
  // French
  { id: 'ff_siwis', name: 'Siwis', gender: 'female', character: 'enthusiastic explainer' },
  // Italian
  { id: 'if_sara', name: 'Sara', gender: 'female', character: 'calm and authoritative' },
  { id: 'im_nicola', name: 'Nicola', gender: 'male', character: 'polished professional' },
  // Portuguese
  { id: 'pf_dora', name: 'Dora', gender: 'female', character: 'upbeat storyteller' },
  { id: 'pm_alex', name: 'Alex', gender: 'male', character: 'friendly conversationalist' },
  // Hindi
  { id: 'hf_alpha', name: 'Alpha', gender: 'female', character: 'articulate intellectual' },
  // Japanese
  { id: 'jf_alpha', name: 'Alpha', gender: 'female', character: 'engaging storyteller' },
  // Chinese
  { id: 'zm_yunjian', name: 'Yunjian', gender: 'male', character: 'authoritative expert' },
];

// ---------------------------------------------------------------------------
// Provider → voice pool map (auto-populated, never needs manual updates)
// ---------------------------------------------------------------------------

import type { TtsProviderId } from './tts-registry';

const PROVIDER_VOICE_POOLS: Partial<Record<TtsProviderId, ProviderVoice[]>> = {
  cartesia: CARTESIA_VOICE_POOL,
  hume: HUME_VOICE_POOL,
  fal: FAL_VOICE_POOL,
  replicate: FAL_VOICE_POOL,
  minimax: MINIMAX_VOICE_POOL,
  mistral: MISTRAL_VOICE_POOL,
  kokoro: KOKORO_VOICE_POOL,
};

/** Voice IDs that can't be derived from a pool (legacy IDs, sidecar presets). */
const SPECIAL_TEST_VOICES: Partial<Record<TtsProviderId, string>> = {
  elevenlabs: '21m00Tcm4TlvDq8ikWAM', // Rachel — stable free voice
  openai: 'alloy',
};

/**
 * Return a stable test voice ID for a TTS provider.
 * Auto-derives from voice pools; falls back to special overrides.
 * New providers with a voice pool need zero changes here.
 */
export function getTestVoiceId(providerId: TtsProviderId): string {
  const special = SPECIAL_TEST_VOICES[providerId];
  if (special) return special;
  const pool = PROVIDER_VOICE_POOLS[providerId];
  if (pool && pool.length > 0) return pool[0].id;
  return 'alloy'; // safe fallback
}

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
  metadata?: VoiceMatchMetadata,
  _language?: string,
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
  metadata?: VoiceMatchMetadata,
  _language?: string,
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
