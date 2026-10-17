/**
 * Generic local TTS sidecar provider.
 *
 * This is the no-code extension point for self-hosters who want to run any
 * local TTS model. Save the sidecar base URL in Sotto. The server implements:
 *
 *   POST /tts    { text, voice, language?, model? } -> audio bytes
 *   GET  /voices { voices: [{ id, label? | name?, gender?, description? }] }
 *   GET  /health { status: "ok" }
 *
 * A saved credential is optional and is sent as a Bearer token when present.
 */
import { logger } from '../../logger';
import type { ProviderTransport } from 'thesidedoor-core/providers/transport';
import { readResponseBytes, readResponseText } from 'thesidedoor-core/runtime/stream';
import type { LocalTtsConnection } from '@/lib/providers/shared/local-tts-connection';
import type { VoiceMatchMetadata } from '../../voice-pool';
import { settleSynchronousProviderResponse, type TtsProvider, type SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { type ProviderVoice, selectVoicePairFromPool, selectVoiceSetFromPool } from '../tts-voices';

const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);

export class LocalTtsHttpError extends Error {
  constructor(
    readonly status: number,
    detail: string
  ) {
    super(`Local TTS sidecar error (${status}): ${detail}`);
    this.name = 'LocalTtsHttpError';
  }
}

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export class LocalTtsProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'local';
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly voices: ProviderVoice[];
  private readonly responseLimits: LocalTtsConnection['responseLimits'];

  constructor(
    connection: LocalTtsConnection,
    private readonly transport: ProviderTransport
  ) {
    this.endpoint = connection.endpoint;
    this.apiKey = connection.apiKey;
    this.model = connection.model;
    this.voices = structuredClone([...connection.voices]);
    this.responseLimits = connection.responseLimits;
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
      const errorText = this.responseLimits
        ? await readResponseText(response, {
            signal: params.signal ?? new AbortController().signal,
            maxBytes: this.responseLimits.maxErrorBytes,
          })
        : await response.text();
      throw new LocalTtsHttpError(response.status, errorText);
    }

    const bytes = this.responseLimits
      ? await readResponseBytes(response, {
          signal: params.signal ?? new AbortController().signal,
          maxBytes: this.responseLimits.maxAudioBytes,
        })
      : new Uint8Array(await response.arrayBuffer());
    params.signal?.throwIfAborted();
    logger.info('Local TTS speech generated', {
      voiceId: params.voiceId,
      model: params.modelId ?? this.model,
      chars: params.text.length,
      language: params.language ?? 'auto',
    });
    return Buffer.from(bytes);
  }

  getVoiceId(
    speaker: string,
    episodeId?: string,
    metadata?: VoiceMatchMetadata,
    _language?: string
  ): string {
    const pool = this.voices;
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
