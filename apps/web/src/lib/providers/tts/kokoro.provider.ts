/**
 * Kokoro TTS provider — keyless, self-hosted local TTS via the Kokoro FastAPI
 * sidecar (services/local-tts). The TTS analog of the keyless local AI
 * (`AI_PROVIDER=local`) and local STT (`STT_PROVIDER=local`) backends.
 *
 * Selected explicitly via `TTS_PROVIDER=kokoro`; never auto-selected by key
 * availability. Requires `TTS_BASE_URL` to point at the sidecar — throws a clear,
 * actionable error if it is unset rather than silently falling back to a cloud
 * provider.
 *
 * Sidecar contract (see services/local-tts/README.md):
 *   POST {TTS_BASE_URL}/tts  body { text, voice, language? } -> audio/wav bytes
 *   GET  {TTS_BASE_URL}/voices
 *   GET  {TTS_BASE_URL}/health
 *
 * Keyless: the sidecar ignores auth. TTS_API_KEY is sent as a Bearer token only
 * when set (for sidecars placed behind a reverse-proxy auth layer).
 */
import { logger } from '../../logger';
import type { TtsProvider, SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { KOKORO_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';
import type { VoiceMatchMetadata } from '../../voice-pool';

// HOST/GUEST → host voice slot; EXPERT/SKEPTIC → expert slot.
const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);

export class KokoroProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'kokoro';
  private baseURL: string;
  private apiKey: string | undefined;
  private model: string;

  constructor(_apiKey?: string, model?: string) {
    const baseURL = process.env.TTS_BASE_URL?.trim();
    if (!baseURL) {
      throw new Error(
        'TTS_BASE_URL is required for TTS_PROVIDER=kokoro. Point it at your local ' +
          'Kokoro sidecar (e.g. http://localhost:8000 locally, or http://local-tts:8000 in Docker).',
      );
    }
    this.baseURL = baseURL.replace(/\/+$/, '');
    // Keyless: the sidecar ignores auth. Only forward TTS_API_KEY if the operator
    // fronted the sidecar with their own auth layer.
    this.apiKey = process.env.TTS_API_KEY?.trim() || undefined;
    this.model = model ?? 'kokoro';
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const body: Record<string, unknown> = {
      text: params.text,
      voice: params.voiceId,
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
        `Could not reach the local Kokoro sidecar at ${this.baseURL}. ` +
          'Is the local-tts service running and TTS_BASE_URL correct? ' +
          `(${err instanceof Error ? err.message : String(err)})`,
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Kokoro sidecar error (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    logger.info('Kokoro speech generated', {
      baseURL: this.baseURL,
      voiceId: params.voiceId,
      chars: params.text.length,
      language: params.language ?? 'auto',
    });
    return Buffer.from(arrayBuffer);
  }

  getVoiceId(speaker: string, podcastId?: string, metadata?: VoiceMatchMetadata, _language?: string): string {
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());
    if (!podcastId) {
      return isHostVoice ? KOKORO_VOICE_POOL[0].id : KOKORO_VOICE_POOL[1].id;
    }
    const pair = selectVoicePairFromPool(KOKORO_VOICE_POOL, podcastId, metadata);
    return isHostVoice ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}
