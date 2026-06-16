/**
 * Voice catalog fetcher — returns available voices for any TTS provider.
 *
 * Dynamic providers (ElevenLabs, Cartesia, Hume) fetch from their API
 * with 24-hour Redis caching. Fixed-set providers (OpenAI, Fal, Replicate)
 * return their static voice pools formatted as CatalogVoice[].
 */

import type { TtsProviderId } from './providers/tts-registry';
import {
  VOICE_POOL,
  type VoicePoolEntry,
} from './voice-pool';
import {
  CARTESIA_VOICE_POOL,
  HUME_VOICE_POOL,
  FAL_VOICE_POOL,
  INWORLD_VOICE_POOL,
  MINIMAX_VOICE_POOL,
  MISTRAL_VOICE_POOL,
  KOKORO_VOICE_POOL,
  DEEPGRAM_AURA_VOICE_POOL,
  RIME_VOICE_POOL,
  PLAYHT_VOICE_POOL,
  getLocalTtsVoicePool,
  type ProviderVoice,
} from './providers/tts-voices';
import { cache } from './redis';
import { logger } from './logger';
import { infra } from './server-config';

export interface CatalogVoice {
  id: string;
  name: string;
  gender?: string;
  age?: string;
  accent?: string;
  description?: string;
}

const CATALOG_TTL = 86400; // 24 hours

// ---------------------------------------------------------------------------
// Static catalogs — built from existing voice pools
// ---------------------------------------------------------------------------

function voicePoolToCatalog(entries: VoicePoolEntry[], provider: 'elevenlabs' | 'openai'): CatalogVoice[] {
  return entries.map((e) => ({
    id: e.ids[provider] ?? e.ids.elevenlabs,
    name: e.name,
    gender: e.gender,
    age: e.ageRange,
    accent: e.accent,
    description: e.character,
  }));
}

function providerVoiceToCatalog(voices: ProviderVoice[]): CatalogVoice[] {
  return voices.map((v) => ({
    id: v.id,
    name: v.name,
    gender: v.gender,
    description: v.character,
  }));
}

const OPENAI_VOICES: CatalogVoice[] = [
  { id: 'alloy', name: 'Alloy', description: 'neutral and balanced' },
  { id: 'echo', name: 'Echo', gender: 'male', description: 'warm and grounded' },
  { id: 'fable', name: 'Fable', gender: 'male', description: 'expressive storyteller' },
  { id: 'onyx', name: 'Onyx', gender: 'male', description: 'deep and authoritative' },
  { id: 'nova', name: 'Nova', gender: 'female', description: 'bright and engaging' },
  { id: 'shimmer', name: 'Shimmer', gender: 'female', description: 'clear and refined' },
  { id: 'ash', name: 'Ash', description: 'calm and composed' },
  { id: 'ballad', name: 'Ballad', description: 'melodic and soothing' },
  { id: 'coral', name: 'Coral', gender: 'female', description: 'warm and friendly' },
  { id: 'sage', name: 'Sage', description: 'thoughtful and measured' },
  { id: 'verse', name: 'Verse', description: 'dynamic and versatile' },
];

// ---------------------------------------------------------------------------
// Dynamic fetchers — API calls with Redis caching
// ---------------------------------------------------------------------------

async function fetchElevenLabsCatalog(apiKey: string): Promise<CatalogVoice[]> {
  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey },
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs voices API error (${response.status})`);
  }

  const data = await response.json();
  const voices: CatalogVoice[] = [];

  for (const v of data.voices) {
    if (v.category !== 'premade' && v.category !== 'professional') continue;
    voices.push({
      id: v.voice_id,
      name: v.name,
      gender: v.labels?.gender,
      age: v.labels?.age,
      accent: v.labels?.accent,
      description: v.labels?.description || v.labels?.use_case,
    });
  }

  return voices;
}

async function fetchCartesiaCatalog(apiKey: string): Promise<CatalogVoice[]> {
  const voices: CatalogVoice[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL('https://api.cartesia.ai/voices');
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('starting_after', cursor);

    const response = await fetch(url.toString(), {
      headers: {
        'X-API-Key': apiKey,
        'Cartesia-Version': '2025-04-16',
      },
    });

    if (!response.ok) {
      throw new Error(`Cartesia voices API error (${response.status})`);
    }

    const page = await response.json() as { data: Record<string, string>[]; next_page?: string; has_more: boolean };
    for (const v of page.data) {
      voices.push({ id: v.id, name: v.name, gender: v.gender, description: v.description });
    }
    cursor = page.has_more ? page.next_page : undefined;
  } while (cursor);

  return voices;
}

async function fetchHumeCatalog(apiKey: string): Promise<CatalogVoice[]> {
  const response = await fetch(
    'https://api.hume.ai/v0/tts/voices?provider=HUME_AI&page_size=100',
    { headers: { 'X-Hume-Api-Key': apiKey } },
  );

  if (!response.ok) {
    throw new Error(`Hume voices API error (${response.status})`);
  }

  const data = await response.json();
  const voiceList = data.voices_page ?? data;
  const items = Array.isArray(voiceList) ? voiceList : (voiceList.items ?? []);

  return items.map((v: Record<string, string>) => ({
    id: v.id,
    name: v.name,
    gender: v.gender,
    age: v.age,
    accent: v.accent,
    description: v.description,
  }));
}

async function fetchLocalCatalog(): Promise<CatalogVoice[]> {
  const baseURL = infra('ttsBaseUrl', 'TTS_BASE_URL')?.replace(/\/+$/, '');
  if (!baseURL) return providerVoiceToCatalog(getLocalTtsVoicePool());

  const headers: Record<string, string> = {};
  const apiKey = process.env.TTS_API_KEY?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(`${baseURL}/voices`, { headers });
  if (!response.ok) {
    throw new Error(`Local TTS voices API error (${response.status})`);
  }

  const data = (await response.json()) as {
    voices?: Array<{
      id: string;
      label?: string;
      name?: string;
      gender?: string;
      description?: string;
    }>;
  };

  const voices = Array.isArray(data.voices) ? data.voices : [];
  if (voices.length === 0) return providerVoiceToCatalog(getLocalTtsVoicePool());

  return voices
    .filter((v) => v.id)
    .map((v) => ({
      id: v.id,
      name: v.name ?? v.label ?? v.id,
      gender: v.gender,
      description: v.description,
    }));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Get the voice catalog for a TTS provider.
 *
 * For dynamic providers (ElevenLabs, Cartesia, Hume), fetches from the API
 * with 24-hour Redis caching. For fixed-set providers, returns static catalogs.
 *
 * Falls back to the static pool on API failure.
 */
export async function getVoiceCatalog(
  providerId: TtsProviderId,
  apiKey?: string,
): Promise<CatalogVoice[]> {
  switch (providerId) {
    case 'elevenlabs': {
      const key = apiKey || process.env.ELEVENLABS_API_KEY;
      if (!key) return voicePoolToCatalog(VOICE_POOL, 'elevenlabs');

      const cacheKey = 'tts:voicecatalog:elevenlabs';
      const cached = await cache.get<CatalogVoice[]>(cacheKey);
      if (cached) return cached;

      try {
        const catalog = await fetchElevenLabsCatalog(key);
        await cache.set(cacheKey, catalog, CATALOG_TTL);
        return catalog;
      } catch (err) {
        logger.warn('ElevenLabs catalog fetch failed, using static pool', {
          error: err instanceof Error ? err.message : String(err),
        });
        return voicePoolToCatalog(VOICE_POOL, 'elevenlabs');
      }
    }

    case 'cartesia': {
      const key = apiKey || process.env.CARTESIA_API_KEY;
      if (!key) return providerVoiceToCatalog(CARTESIA_VOICE_POOL);

      const cacheKey = 'tts:voicecatalog:cartesia';
      const cached = await cache.get<CatalogVoice[]>(cacheKey);
      if (cached) return cached;

      try {
        const catalog = await fetchCartesiaCatalog(key);
        await cache.set(cacheKey, catalog, CATALOG_TTL);
        return catalog;
      } catch (err) {
        logger.warn('Cartesia catalog fetch failed, using static pool', {
          error: err instanceof Error ? err.message : String(err),
        });
        return providerVoiceToCatalog(CARTESIA_VOICE_POOL);
      }
    }

    case 'hume': {
      const key = apiKey || process.env.HUME_API_KEY;
      if (!key) return providerVoiceToCatalog(HUME_VOICE_POOL);

      const cacheKey = 'tts:voicecatalog:hume';
      const cached = await cache.get<CatalogVoice[]>(cacheKey);
      if (cached) return cached;

      try {
        const catalog = await fetchHumeCatalog(key);
        await cache.set(cacheKey, catalog, CATALOG_TTL);
        return catalog;
      } catch (err) {
        logger.warn('Hume catalog fetch failed, using static pool', {
          error: err instanceof Error ? err.message : String(err),
        });
        return providerVoiceToCatalog(HUME_VOICE_POOL);
      }
    }

    case 'openai':
      return OPENAI_VOICES;

    case 'fal':
      return providerVoiceToCatalog(FAL_VOICE_POOL);

    case 'replicate':
      return providerVoiceToCatalog(INWORLD_VOICE_POOL);

    case 'minimax':
      return providerVoiceToCatalog(MINIMAX_VOICE_POOL);

    case 'mistral':
      return providerVoiceToCatalog(MISTRAL_VOICE_POOL);

    case 'kokoro':
      return providerVoiceToCatalog(KOKORO_VOICE_POOL);

    case 'deepgram':
      return providerVoiceToCatalog(DEEPGRAM_AURA_VOICE_POOL);

    case 'rime':
      return providerVoiceToCatalog(RIME_VOICE_POOL);

    case 'playht':
      return providerVoiceToCatalog(PLAYHT_VOICE_POOL);

    case 'local': {
      const cacheKey = 'tts:voicecatalog:local';
      const cached = await cache.get<CatalogVoice[]>(cacheKey);
      if (cached) return cached;

      try {
        const catalog = await fetchLocalCatalog();
        await cache.set(cacheKey, catalog, CATALOG_TTL);
        return catalog;
      } catch (err) {
        logger.warn('Local TTS catalog fetch failed, using configured voices', {
          error: err instanceof Error ? err.message : String(err),
        });
        return providerVoiceToCatalog(getLocalTtsVoicePool());
      }
    }

    default:
      return voicePoolToCatalog(VOICE_POOL, 'elevenlabs');
  }
}
