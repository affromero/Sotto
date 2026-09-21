/**
 * Kokoro TTS provider — keyless, self-hosted local TTS via the Kokoro FastAPI
 * sidecar (services/local-tts).
 *
 * The saved provider selection and base URL point at the sidecar. Missing
 * configuration raises a clear error.
 *
 * Sidecar contract (see services/local-tts/README.md):
 *   POST {baseUrl}/tts  body { text, voice, language? } -> audio/wav bytes
 *   GET  {baseUrl}/voices
 *   GET  {baseUrl}/health
 *
 * Keyless sidecars ignore auth. A saved credential is sent as a Bearer token
 * when the sidecar sits behind an authenticated reverse proxy.
 */
import { logger } from '../../logger';
import { settleSynchronousProviderResponse, type TtsProvider, type SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { selectVoicePairFromPool, type ProviderVoice } from '../tts-voices';
import type { VoiceMatchMetadata } from '../../voice-pool';
import type { ProviderTransport } from 'thesidedoor-core/providers/transport';
import type { LocalTtsConnection } from '@/lib/providers/shared/local-tts-connection';

// HOST/GUEST → host voice slot; EXPERT/SKEPTIC → expert slot.
const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);

export class KokoroProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'kokoro';
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly voices: ProviderVoice[];

  constructor(
    connection: LocalTtsConnection,
    private readonly transport: ProviderTransport
  ) {
    this.endpoint = connection.endpoint;
    this.apiKey = connection.apiKey;
    this.model = connection.model;
    this.voices = structuredClone([...connection.voices]);
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const body: Record<string, unknown> = {
      text: params.text,
      voice: params.voiceId,
    };
    if (params.language) body.language = params.language;

    const response = await this.transport.authenticatedFetch(
      this.endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: params.signal,
      },
      {
        onDispatch: params.onDispatch ?? (() => {}),
        onConsumed: settleSynchronousProviderResponse(params.onSettled),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Kokoro sidecar error (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    params.signal?.throwIfAborted();
    logger.info('Kokoro speech generated', {
      voiceId: params.voiceId,
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
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());
    if (!episodeId) {
      return isHostVoice ? this.voices[0].id : this.voices[1].id;
    }
    const pair = selectVoicePairFromPool(this.voices, episodeId, metadata);
    return isHostVoice ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}
