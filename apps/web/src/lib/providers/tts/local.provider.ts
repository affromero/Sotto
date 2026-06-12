/**
 * Generic local TTS sidecar provider.
 *
 * This is the no-code extension point for self-hosters who want to run any
 * local TTS model. Point TTS_PROVIDER=local and TTS_BASE_URL at a small HTTP
 * server that implements:
 *
 *   POST /tts    { text, voice, language?, model? } -> audio bytes
 *   GET  /voices { voices: [{ id, label? | name?, gender?, description? }] }
 *   GET  /health { status: "ok" }
 *
 * TTS_API_KEY is optional and sent as a Bearer token only when set.
 */
import { logger } from '../../logger';
import { infra } from '../../server-config';
import type { VoiceMatchMetadata } from '../../voice-pool';
import type { TtsProvider, SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import {
  getLocalTtsVoicePool,
  selectVoicePairFromPool,
  selectVoiceSetFromPool,
} from '../tts-voices';

const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export class LocalTtsProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'local';
  private baseURL: string;
  private apiKey: string | undefined;
  private model: string;

  constructor(_apiKey?: string, model?: string) {
    const baseURL = infra('ttsBaseUrl', 'TTS_BASE_URL');
    if (!baseURL) {
      throw new Error(
        'TTS_BASE_URL is required for TTS_PROVIDER=local. Point it at a local ' +
          'Sotto-compatible TTS sidecar (for example http://localhost:8000 locally, ' +
          'or http://local-tts:8000 in Docker).'
      );
    }
    this.baseURL = baseURL.replace(/\/+$/, '');
    this.apiKey = process.env.TTS_API_KEY?.trim() || undefined;
    const requestedModel = model?.trim();
    const envModel = process.env.TTS_MODEL?.trim();
    this.model = requestedModel || envModel || 'local';
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const body: Record<string, unknown> = {
      text: params.text,
      voice: params.voiceId,
      model: params.modelId ?? this.model,
    };
    if (params.language) body.language = params.language;

    let response: Response;
    try {
      response = await fetch(`${this.baseURL}/tts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `Could not reach the local TTS sidecar at ${this.baseURL}. ` +
          'Is the service running and TTS_BASE_URL correct? ' +
          `(${err instanceof Error ? err.message : String(err)})`
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Local TTS sidecar error (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    logger.info('Local TTS speech generated', {
      baseURL: this.baseURL,
      voiceId: params.voiceId,
      model: params.modelId ?? this.model,
      chars: params.text.length,
      language: params.language ?? 'auto',
    });
    return Buffer.from(arrayBuffer);
  }

  getVoiceId(
    speaker: string,
    episodeId?: string,
    metadata?: VoiceMatchMetadata,
    _language?: string
  ): string {
    const pool = getLocalTtsVoicePool();
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());

    if (pool.length === 0) return isHostVoice ? 'default' : 'alternate';
    if (!episodeId) {
      return isHostVoice ? pool[0].id : (pool[1] ?? pool[0]).id;
    }
    if (pool.length >= 2 && (speaker === 'HOST' || speaker === 'EXPERT')) {
      const pair = selectVoicePairFromPool(pool, episodeId, metadata);
      return isHostVoice ? pair.host.id : pair.expert.id;
    }

    const voices = selectVoiceSetFromPool(pool, episodeId, Math.min(pool.length, 8), metadata);
    const index = hashString(`${episodeId}:${speaker}`) % voices.length;
    return voices[index]?.id ?? pool[0].id;
  }

  getModelId(): string {
    return this.model;
  }
}
