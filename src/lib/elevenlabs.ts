import { logger } from './logger';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

if (!ELEVENLABS_API_KEY) {
  logger.warn('ELEVENLABS_API_KEY is not set — audio generation will not work');
}

// ---------------------------------------------------------------------------
// Voice Pool — diverse voices so every podcast sounds unique
// ---------------------------------------------------------------------------
// Each voice entry includes a name for logging, ElevenLabs voice_id, and
// metadata (gender, accent, age range, character) used for voice assignment.

export interface VoiceProfile {
  id: string;
  name: string;
  gender: 'male' | 'female';
  accent: 'american' | 'british' | 'australian' | 'indian' | 'african';
  ageRange: 'young' | 'middle' | 'mature';
  character: string; // e.g. "warm storyteller", "energetic explainer"
}

// Pre-built voice pool — curated for podcast hosting and expert roles.
// These are public ElevenLabs voices available on all paid plans.
const VOICE_POOL: VoiceProfile[] = [
  // --- Male voices ---
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male', accent: 'american', ageRange: 'middle', character: 'warm narrator' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', gender: 'male', accent: 'american', ageRange: 'young', character: 'friendly conversationalist' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', gender: 'male', accent: 'american', ageRange: 'mature', character: 'authoritative expert' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', gender: 'male', accent: 'american', ageRange: 'young', character: 'upbeat storyteller' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', gender: 'male', accent: 'american', ageRange: 'middle', character: 'confident presenter' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', gender: 'male', accent: 'australian', ageRange: 'young', character: 'casual and curious' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male', accent: 'british', ageRange: 'mature', character: 'distinguished professor' },
  { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', accent: 'british', ageRange: 'middle', character: 'articulate intellectual' },
  // --- Female voices ---
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', gender: 'female', accent: 'american', ageRange: 'young', character: 'engaging storyteller' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'female', accent: 'american', ageRange: 'middle', character: 'calm and authoritative' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', gender: 'female', accent: 'american', ageRange: 'young', character: 'enthusiastic explainer' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', gender: 'female', accent: 'american', ageRange: 'young', character: 'energetic and playful' },
  { id: 'z9fAnlkpzviPz146aGWa', name: 'Glinda', gender: 'female', accent: 'american', ageRange: 'mature', character: 'wise mentor' },
  { id: 'jsCqWAovK2LkecY7zXl4', name: 'Freya', gender: 'female', accent: 'british', ageRange: 'young', character: 'witty and sharp' },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female', accent: 'british', ageRange: 'middle', character: 'polished professional' },
  { id: 'oWAxZDx7w5VEj9dCyTzz', name: 'Grace', gender: 'female', accent: 'australian', ageRange: 'middle', character: 'warm and approachable' },
];

/**
 * Select a diverse voice pair for a podcast.
 * Uses a seed (podcast ID hash) for deterministic but varied assignment.
 * Ensures the host and expert always have different voices, and ideally
 * different genders or accents for auditory contrast.
 */
export function selectVoicePair(podcastId: string): { host: VoiceProfile; expert: VoiceProfile } {
  // Simple hash from podcast ID for deterministic selection
  let hash = 0;
  for (let i = 0; i < podcastId.length; i++) {
    hash = ((hash << 5) - hash + podcastId.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash);

  // Pick host from the pool
  const hostIndex = index % VOICE_POOL.length;
  const host = VOICE_POOL[hostIndex];

  // Pick expert: different voice, prefer different gender for contrast
  const candidates = VOICE_POOL.filter((v) => v.id !== host.id);
  const contrastCandidates = candidates.filter((v) => v.gender !== host.gender);
  const expertPool = contrastCandidates.length > 0 ? contrastCandidates : candidates;
  const expertIndex = (index >>> 8) % expertPool.length;
  const expert = expertPool[expertIndex];

  return { host, expert };
}

/**
 * Get voice ID for a speaker role on a specific podcast.
 * Falls back to env overrides if set, otherwise uses the voice pool.
 */
export function getVoiceId(speaker: 'HOST' | 'EXPERT', podcastId?: string): string {
  // Allow env overrides for custom setups
  const envHost = process.env.ELEVENLABS_HOST_VOICE_ID;
  const envExpert = process.env.ELEVENLABS_EXPERT_VOICE_ID;
  if (envHost && envExpert) {
    return speaker === 'HOST' ? envHost : envExpert;
  }

  if (!podcastId) {
    // Fallback to first pair if no podcast ID provided
    return speaker === 'HOST' ? VOICE_POOL[0].id : VOICE_POOL[8].id;
  }

  const pair = selectVoicePair(podcastId);
  return speaker === 'HOST' ? pair.host.id : pair.expert.id;
}

/**
 * Get the full voice profile for logging and metadata
 */
export function getVoiceProfile(voiceId: string): VoiceProfile | undefined {
  return VOICE_POOL.find((v) => v.id === voiceId);
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
}): Promise<Buffer> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured — set ELEVENLABS_API_KEY');
  }

  const response = await fetch(
    `${ELEVENLABS_BASE_URL}/text-to-speech/${params.voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
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
    }
  );

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
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured — set ELEVENLABS_API_KEY');
  }

  const body: Record<string, unknown> = { text: params.prompt };
  if (params.durationSeconds) {
    body.duration_seconds = Math.min(params.durationSeconds, 30);
  }

  const response = await fetch(`${ELEVENLABS_BASE_URL}/sound-generation`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
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
  logger.info('Sound effect generated', { prompt: params.prompt, durationSeconds: String(params.durationSeconds ?? 'auto') });
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// Voice Design — create entirely new voices from text descriptions
// ---------------------------------------------------------------------------

export async function designVoice(params: {
  description: string;
  sampleText: string;
}): Promise<{ voiceId: string; audioPreview: Buffer }> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured — set ELEVENLABS_API_KEY');
  }

  const response = await fetch(`${ELEVENLABS_BASE_URL}/voice-generation/generate-voice`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
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
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured');
  }

  const response = await fetch(`${ELEVENLABS_BASE_URL}/voices`, {
    headers: { 'xi-api-key': ELEVENLABS_API_KEY },
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
  free: 0.00,
  starter: 0.30,
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
  if (!ELEVENLABS_API_KEY) {
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
      'xi-api-key': ELEVENLABS_API_KEY,
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
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured');
  }

  const response = await fetch(`${ELEVENLABS_BASE_URL}/voices/${voiceId}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': ELEVENLABS_API_KEY },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs voice deletion error (${response.status}): ${errorText}`);
  }

  logger.info('Cloned voice deleted', { voiceId });
}

// Export the pool for external access (e.g. voice selection UI)
export { VOICE_POOL };
