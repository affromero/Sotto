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
// PlayHT voices — curated subset of PlayHT's voice library
// ---------------------------------------------------------------------------

export const PLAYHT_VOICE_POOL: ProviderVoice[] = [
  {
    id: 's3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json',
    name: 'Jennifer',
    gender: 'female',
    character: 'warm narrator',
  },
  {
    id: 's3://voice-cloning-zero-shot/e040bd1b-f190-4bdb-83f0-75ef85b18f84/original/manifest.json',
    name: 'Michael',
    gender: 'male',
    character: 'confident presenter',
  },
  {
    id: 's3://voice-cloning-zero-shot/801a663f-efd0-4254-98d0-5c175514c3e8/adrianSaad/manifest.json',
    name: 'Adrian',
    gender: 'male',
    character: 'articulate intellectual',
  },
  {
    id: 's3://voice-cloning-zero-shot/baf1ef41-36b6-428c-9bdf-50ba54682571/original/manifest.json',
    name: 'Charlotte',
    gender: 'female',
    character: 'polished professional',
  },
  {
    id: 's3://voice-cloning-zero-shot/65977f5e-a22a-4b36-861b-1a3b03fa7094/original/manifest.json',
    name: 'Daniel',
    gender: 'male',
    character: 'friendly conversationalist',
  },
  {
    id: 's3://voice-cloning-zero-shot/a59cb96e-87ad-46d1-a7c4-8e8a18787e07/original/manifest.json',
    name: 'Sophia',
    gender: 'female',
    character: 'enthusiastic explainer',
  },
  {
    id: 's3://voice-cloning-zero-shot/d82d246c-148b-457f-9668-37b789520891/original/manifest.json',
    name: 'James',
    gender: 'male',
    character: 'authoritative expert',
  },
  {
    id: 's3://voice-cloning-zero-shot/adb83b67-8d75-48ff-ad4d-a0840d231ef1/original/manifest.json',
    name: 'Emma',
    gender: 'female',
    character: 'engaging storyteller',
  },
  {
    id: 's3://voice-cloning-zero-shot/1591b954-8760-41a3-b3e1-4e0aa72e7884/original/manifest.json',
    name: 'Thomas',
    gender: 'male',
    character: 'casual and curious',
  },
  {
    id: 's3://voice-cloning-zero-shot/15a85d27-58ef-4c47-a4f0-4a694b8e6e5c/original/manifest.json',
    name: 'Olivia',
    gender: 'female',
    character: 'wise mentor',
  },
];

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
// Hume AI voices — description-based voice system
// ---------------------------------------------------------------------------

export const HUME_VOICE_POOL: ProviderVoice[] = [
  { id: 'ITO', name: 'Ito', gender: 'female', character: 'warm narrator' },
  { id: 'KORA', name: 'Kora', gender: 'female', character: 'polished professional' },
  { id: 'DACHER', name: 'Dacher', gender: 'male', character: 'authoritative expert' },
  { id: 'AURA', name: 'Aura', gender: 'female', character: 'enthusiastic explainer' },
  { id: 'FINN', name: 'Finn', gender: 'male', character: 'friendly conversationalist' },
  { id: 'STELLA', name: 'Stella', gender: 'female', character: 'engaging storyteller' },
  { id: 'ORBIT', name: 'Orbit', gender: 'male', character: 'confident presenter' },
  { id: 'SUNNY', name: 'Sunny', gender: 'female', character: 'casual and curious' },
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
