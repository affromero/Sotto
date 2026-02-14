import { logger } from './logger';
import {
  VOICE_POOL as POOL,
  selectVoicePair as selectPair,
  findByVoiceId,
  type VoicePoolEntry,
} from './voice-pool';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

// Helper to get API key dynamically for better testability
function getApiKey(): string | undefined {
  return process.env.ELEVENLABS_API_KEY;
}

if (!getApiKey()) {
  logger.warn('ELEVENLABS_API_KEY is not set — audio generation will not work');
}

// ---------------------------------------------------------------------------
// Voice Pool — re-exported from voice-pool.ts for backward compatibility
// ---------------------------------------------------------------------------

/** @deprecated Use VoicePoolEntry from voice-pool.ts directly */
export interface VoiceProfile {
  id: string;
  name: string;
  gender: 'male' | 'female';
  accent: 'american' | 'british' | 'australian' | 'indian' | 'african';
  ageRange: 'young' | 'middle' | 'mature';
  character: string;
}

/** Map VoicePoolEntry to legacy VoiceProfile shape */
function toLegacy(entry: VoicePoolEntry): VoiceProfile {
  return {
    id: entry.ids.elevenlabs,
    name: entry.name,
    gender: entry.gender,
    accent: entry.accent,
    ageRange: entry.ageRange,
    character: entry.character,
  };
}

const VOICE_POOL: VoiceProfile[] = POOL.map(toLegacy);

export function selectVoicePair(podcastId: string): { host: VoiceProfile; expert: VoiceProfile } {
  const pair = selectPair(podcastId);
  return { host: toLegacy(pair.host), expert: toLegacy(pair.expert) };
}

/**
 * Get voice ID for a speaker role on a specific podcast.
 * Falls back to env overrides if set, otherwise uses the voice pool.
 */
export function getVoiceId(speaker: 'HOST' | 'EXPERT', podcastId?: string): string {
  const envHost = process.env.ELEVENLABS_HOST_VOICE_ID;
  const envExpert = process.env.ELEVENLABS_EXPERT_VOICE_ID;
  if (envHost && envExpert) {
    return speaker === 'HOST' ? envHost : envExpert;
  }

  if (!podcastId) {
    return speaker === 'HOST' ? VOICE_POOL[0].id : VOICE_POOL[8].id;
  }

  const pair = selectVoicePair(podcastId);
  return speaker === 'HOST' ? pair.host.id : pair.expert.id;
}

/**
 * Get the full voice profile for logging and metadata
 */
export function getVoiceProfile(voiceId: string): VoiceProfile | undefined {
  const entry = findByVoiceId(voiceId);
  return entry ? toLegacy(entry) : undefined;
}

// ---------------------------------------------------------------------------
// Text-to-Speech
// ---------------------------------------------------------------------------

export async function generateSpeech(params: {
  text: string;
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  apiKeyOverride?: string;
}): Promise<Buffer> {
  const apiKey = params.apiKeyOverride || getApiKey();
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured — set ELEVENLABS_API_KEY');
  }

  const response = await fetch(`${ELEVENLABS_BASE_URL}/text-to-speech/${params.voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: params.text,
      model_id: params.modelId || 'eleven_multilingual_v2',
      voice_settings: {
        stability: params.stability ?? 0.5,
        similarity_boost: params.similarityBoost ?? 0.75,
        style: params.style ?? 0.3,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// Sound Effects — generate ambient audio, transitions, intros
// ---------------------------------------------------------------------------

export async function generateSoundEffect(params: {
  prompt: string;
  durationSeconds?: number;
}): Promise<Buffer> {
  if (!getApiKey()) {
    throw new Error('ElevenLabs API key not configured — set ELEVENLABS_API_KEY');
  }

  const body: Record<string, unknown> = { text: params.prompt };
  if (params.durationSeconds) {
    body.duration_seconds = Math.min(params.durationSeconds, 30);
  }

  const response = await fetch(`${ELEVENLABS_BASE_URL}/sound-generation`, {
    method: 'POST',
    headers: {
      'xi-api-key': getApiKey()!,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs Sound Effects API error (${response.status}): ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  logger.info('Sound effect generated', {
    prompt: params.prompt,
    durationSeconds: String(params.durationSeconds ?? 'auto'),
  });
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// Voice Design — create entirely new voices from text descriptions
// ---------------------------------------------------------------------------

export async function designVoice(params: {
  description: string;
  sampleText: string;
}): Promise<{ voiceId: string; audioPreview: Buffer }> {
  if (!getApiKey()) {
    throw new Error('ElevenLabs API key not configured — set ELEVENLABS_API_KEY');
  }

  const response = await fetch(`${ELEVENLABS_BASE_URL}/voice-generation/generate-voice`, {
    method: 'POST',
    headers: {
      'xi-api-key': getApiKey()!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      voice_description: params.description,
      text: params.sampleText,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs Voice Design API error (${response.status}): ${errorText}`);
  }

  const voiceId = response.headers.get('generated_voice_id') || '';
  const arrayBuffer = await response.arrayBuffer();

  logger.info('Custom voice designed', { description: params.description, voiceId });
  return { voiceId, audioPreview: Buffer.from(arrayBuffer) };
}

// ---------------------------------------------------------------------------
// Voice Library
// ---------------------------------------------------------------------------

export async function getVoices(): Promise<
  Array<{ voice_id: string; name: string; category: string }>
> {
  if (!getApiKey()) {
    throw new Error('ElevenLabs API key not configured');
  }

  const response = await fetch(`${ELEVENLABS_BASE_URL}/voices`, {
    headers: { 'xi-api-key': getApiKey()! },
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs API error (${response.status})`);
  }

  const data = await response.json();
  return data.voices;
}

// ---------------------------------------------------------------------------
// Cost Tracking
// ---------------------------------------------------------------------------

const ELEVENLABS_RATE_PER_K_CHARS: Record<string, number> = {
  free: 0.0,
  starter: 0.3,
  creator: 0.24,
  scale: 0.17,
};

/**
 * Get the ElevenLabs cost per 1,000 characters based on the account tier.
 * Configured via ELEVENLABS_TIER env var (default: 'scale').
 */
export function getElevenLabsPerKCharRate(): number {
  const tier = process.env.ELEVENLABS_TIER || 'scale';
  return ELEVENLABS_RATE_PER_K_CHARS[tier] ?? 0.17;
}

/**
 * Get the OpenAI TTS cost per 1,000 characters.
 * tts-1-hd: $15/1M chars = $0.015/1K chars
 */
export function getOpenAiPerKCharRate(): number {
  return 0.015;
}

// ---------------------------------------------------------------------------
// Voice Cloning (Instant Voice Cloning — IVC)
// ---------------------------------------------------------------------------

/**
 * Clone a voice from audio samples using ElevenLabs Instant Voice Cloning.
 * Requires a paid ElevenLabs plan.
 */
export async function cloneVoice(
  name: string,
  audioFiles: Buffer[],
  description?: string
): Promise<{ voiceId: string }> {
  if (!getApiKey()) {
    throw new Error('ElevenLabs API key not configured — set ELEVENLABS_API_KEY');
  }

  const formData = new FormData();
  formData.append('name', name);
  if (description) {
    formData.append('description', description);
  }

  for (let i = 0; i < audioFiles.length; i++) {
    const uint8 = new Uint8Array(audioFiles[i]);
    const blob = new Blob([uint8], { type: 'audio/mpeg' });
    formData.append('files', blob, `sample_${i}.mp3`);
  }

  const response = await fetch(`${ELEVENLABS_BASE_URL}/voices/add`, {
    method: 'POST',
    headers: {
      'xi-api-key': getApiKey()!,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs Voice Cloning error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  logger.info('Voice cloned successfully', { name, voiceId: data.voice_id });
  return { voiceId: data.voice_id };
}

/**
 * Delete a cloned voice from ElevenLabs.
 */
export async function deleteClonedVoice(voiceId: string): Promise<void> {
  if (!getApiKey()) {
    throw new Error('ElevenLabs API key not configured');
  }

  const response = await fetch(`${ELEVENLABS_BASE_URL}/voices/${voiceId}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': getApiKey()! },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs voice deletion error (${response.status}): ${errorText}`);
  }

  logger.info('Cloned voice deleted', { voiceId });
}

// Export the pool for external access (e.g. voice selection UI)
export { VOICE_POOL };
